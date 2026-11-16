// End-to-end run of the formal WageProof CosmWasm contract on ME testnet.
// Every expected rejection is broadcast with a fixed fee (no simulate) so the failed tx lands in a
// block and has a hash anyone can look up; the simulate error is saved too.
//
// Usage:
//   node scripts/cw-e2e.mjs          groups (1)-(4)  -> docs/evidence/cw-c-e2e.txt
//   node scripts/cw-e2e.mjs --full   full flow with an employer that has a ME ID (>= one). The faucet's
//                                    Testnet ME ID service stopped writing on-chain after 2026-11-13, so the
//                                    new Cosmos-key employer never got one; --full signs as the old demo
//                                    employer (KYC_LEVEL_TWO, EVM key) via scripts/eth-signer.mjs.
//                                    -> docs/evidence/cw-c-e2e-full.txt
// Keys: main wallet from .env, demo accounts from .env.demo (DEMO_CW_*_MNEMONIC). Never printed.
import { join } from "node:path";
import { createHash } from "node:crypto";
import { toBase64, toUtf8 } from "@cosmjs/encoding";
import { config, ROOT } from "./lib.mjs";
import { hashReport } from "./hash-report.mjs";
import { connect, broadcast, execMsg, loadDeploy, logger, readDemoMnemonic } from "./cw-lib.mjs";
import { connectEthKey, readDemoKey } from "./eth-signer.mjs";

const FULL = process.argv.includes("--full");
const log = logger(join(ROOT, "docs", "evidence", FULL ? "cw-c-e2e-full.txt" : "cw-c-e2e.txt"));
const C = loadDeploy().wageProof?.contract;
if (!C) throw new Error("no wageProof in deployments/cw-testnet.json; run node scripts/cw-deploy.mjs");

const NO_MEID = "me1mhyngg3dww60msw6dej4mkzheewjck86450e7g";
const OLD_EMP_TWO = "me1hhqvymvnz5mz3jf5pg4ar4vxhyxsyrqr7tgwyf";
const NEW_EMP = "me1lds7z464trmvjmpsv34npkftdlkujppw95nrd5";
const REPORT = hashReport(join(ROOT, "demo", "synthetic-report.json")).slice(2);
const REPORT2 = hashReport(join(ROOT, "demo", "synthetic-report-2.json")).slice(2);
const REASON = createHash("sha256").update("synthetic demo reason: hours on the report do not match the roster").digest("hex");

const txUrl = (h) => `${config.hub.rest}/cosmos/tx/v1beta1/txs/${h}`;
const smartUrl = (q) => `${config.hub.rest}/cosmwasm/wasm/v1/contract/${C}/smart/${encodeURIComponent(toBase64(toUtf8(JSON.stringify(q))))}`;
let pass = 0, fail = 0;
const check = (ok, what) => { ok ? pass++ : fail++; log(`  ${ok ? "PASS" : "UNEXPECTED"}: ${what}`); };

const main = await connect();
const worker = await connect(readDemoMnemonic("DEMO_CW_WORKER_MNEMONIC"));
const employer = FULL ? await connectEthKey(readDemoKey("DEMO_EMPLOYER_KEY"), main.client.registry)
  : await connect(readDemoMnemonic("DEMO_CW_EMPLOYER_MNEMONIC"));
const q = async (msg) => main.client.queryContractSmart(C, msg);
const blockTime = async () => Date.parse((await main.client.getBlock()).header.time) / 1000;

async function query(label, msg) {
  try { const r = await q(msg); log(`query ${label}:`, r); log(`  REST: ${smartUrl(msg)}`); return r; }
  catch (e) { log(`query ${label} ERROR (raw):`, String(e.message ?? e)); return null; }
}

async function ok(label, who, msg) {
  const { res, fee } = await broadcast(who.client, who.address, [execMsg(who.address, C, msg)]);
  const wasm = res.events.filter((e) => e.type === "wasm").flatMap((e) => e.attributes)
    .filter((a) => a.key !== "_contract_address").map((a) => `${a.key}=${a.value}`).join(" ");
  log(`TX ${label}: OK hash=${res.transactionHash} height=${res.height} fee=${fee.amount[0].amount}umec`);
  log(`  wasm event: ${wasm}`);
  log(`  REST: ${txUrl(res.transactionHash)}`);
  return Object.fromEntries(res.events.filter((e) => e.type === "wasm").flatMap((e) => e.attributes).map((a) => [a.key, a.value]));
}

// Expected rejection: save simulate error, then broadcast with fixed fee so it is recorded on chain.
async function rejected(label, who, msg, expect) {
  const m = execMsg(who.address, C, msg);
  let sim = "";
  try { await who.client.simulate(who.address, [m], ""); sim = "(simulate succeeded!)"; }
  catch (e) { sim = String(e.message ?? e); }
  log(`TX ${label}: expect "${expect}"`);
  log(`  simulate error (raw): ${sim}`);
  const res = await who.client.signAndBroadcast(who.address, [m], { amount: [{ denom: config.denom, amount: config.minFeeUmec }], gas: "500000" }, "");
  log(`  on-chain: code=${res.code} hash=${res.transactionHash} height=${res.height} gasUsed=${res.gasUsed}/500000`);
  log(`  on-chain raw_log: ${res.rawLog}`);
  log(`  REST: ${txUrl(res.transactionHash)}`);
  check(res.code !== 0 && String(res.rawLog).includes(expect) && sim.includes(expect), `${label} rejected with ${expect}`);
  return res;
}

async function waitPastDeadline(id) {
  const r = await q({ record: { id } });
  for (let i = 0; i < 40; i++) {
    const t = await blockTime();
    // contract time is whole seconds (block time floored) and the rule is strict `now > deadline`
    if (Math.floor(t) > r.deadline) { log(`latest block time ${t} > deadline ${r.deadline}`); return; }
    await new Promise((s) => setTimeout(s, 3000));
  }
  throw new Error("deadline not passed after 120 s");
}

log(`# WageProof CosmWasm e2e ${FULL ? "--full " : ""}${new Date().toISOString()}`);
log(`chain=${config.cosmosChainId} rpc=${config.hub.rpc} contract=${C} codeId=${loadDeploy().wageProof.codeId}`);
log(`accounts: main=${main.address} worker=${worker.address} employer=${employer.address}${FULL ? " (old demo employer, EVM key, signed as ethsecp256k1)" : ""}`);
log(`report_hash=${REPORT} (sha256 of demo/synthetic-report.json, synthetic data)`);
await query("config", { config: {} });
const before = await query("count (before)", { count: {} });

if (!FULL) {
  log("\n## (1) employer without ME ID -> contract rejects");
  await query("me_id NO_MEID", { me_id: { address: NO_MEID } });
  await rejected("(1) worker submit, employer=" + NO_MEID, worker,
    { submit: { report_hash: REPORT, employer: NO_MEID, deadline_seconds: 30 } }, "EmployerNotVerified");
  const after1 = await query("count (after 1)", { count: {} });
  check(after1 === before, `count unchanged ${before} -> ${after1}`);

  log("\n## (2) employer with ME ID level two -> accepted, levels stored");
  await query("me_id OLD_EMP_TWO", { me_id: { address: OLD_EMP_TWO } });
  const ev = await ok("(2) worker submit, employer=" + OLD_EMP_TWO + ", 30 s", worker,
    { submit: { report_hash: REPORT, employer: OLD_EMP_TWO, deadline_seconds: 30 } });
  const id = Number(ev.id);
  const rec = await query(`record ${id}`, { record: { id } });
  check(rec?.employer_level === "two" && rec?.worker_level === "none", `record ${id} employer_level=${rec?.employer_level} worker_level=${rec?.worker_level}`);
  await query("records_for_report", { records_for_report: { report_hash: REPORT } });
  await query("list (latest 3)", { list: { limit: 3 } });

  log("\n## (3) 30 s deadline -> wait -> anyone marks expired");
  await rejected(`(3a) main marks #${id} expired before deadline`, main, { mark_expired: { id } }, "DeadlineNotPassed");
  await rejected(`(3b) worker tries to confirm #${id} (not the employer)`, worker, { confirm: { id } }, "NotEmployer");
  await waitPastDeadline(id);
  const es = await query(`effective_status ${id}`, { effective_status: { id } });
  const raw = await query(`record ${id} status`, { record: { id } });
  check(es === "expired" && raw?.status === "pending", `effective_status=${es} while stored status=${raw?.status}`);
  const ex = await ok(`(3c) main marks #${id} expired`, main, { mark_expired: { id } });
  check(ex.caller === main.address, `caller attribute = third party ${ex.caller}`);
  await rejected(`(3d) worker marks #${id} expired again`, worker, { mark_expired: { id } }, "NotPending");
  await rejected(`(3e) worker disputes #${id} after expiry (not the employer)`, worker, { dispute: { id, reason_hash: REASON } }, "NotEmployer");
  await rejected("(3f) unknown id 999999", main, { mark_expired: { id: 999999 } }, "NoSuchRecord");
  await query(`record ${id} (final)`, { record: { id } });

  log("\n## (4) new demo employer: ME ID?");
  const me = await query("me_id NEW_EMP", { me_id: { address: NEW_EMP } });
  if (me && me.level !== "none") {
    log(`new demo employer has ME ID level ${me.level}: run node scripts/cw-e2e.mjs --full`);
  } else {
    await rejected("(4) worker submit, employer=" + NEW_EMP + " (no ME ID yet)", worker,
      { submit: { report_hash: REPORT2, employer: NEW_EMP, deadline_seconds: 600 } }, "EmployerNotVerified");
    log("full flow waits for the new demo employer's ME ID; then run: node scripts/cw-e2e.mjs --full");
  }
} else {
  log("\n## --full: employer with ME ID, full flow");
  const EMP = employer.address;
  const me = await query("me_id employer", { me_id: { address: EMP } });
  if (!me || me.level === "none") {
    log(`STOP: employer ${EMP} has no ME ID (level ${me?.level}, source ${me?.source}). Nothing sent.`);
    log.save(); process.exit(3);
  }
  await query("me_id worker", { me_id: { address: worker.address } });
  const sub = async (tag, window) => Number((await ok(`${tag} worker submit, ${window} s`, worker,
    { submit: { report_hash: REPORT2, employer: EMP, deadline_seconds: window } })).id);
  const a = await sub("(F1)", 600);
  await ok(`(F1) employer confirms #${a}`, employer, { confirm: { id: a } });
  const b = await sub("(F2)", 600);
  await ok(`(F2) employer disputes #${b}`, employer, { dispute: { id: b, reason_hash: REASON } });
  const c = await sub("(F3)", 600);
  await rejected(`(F3) worker tries to confirm #${c}`, worker, { confirm: { id: c } }, "NotEmployer");
  await rejected(`(F4) employer confirms #${a} again`, employer, { confirm: { id: a } }, "NotPending");
  await rejected(`(F4) employer disputes #${b} again`, employer, { dispute: { id: b, reason_hash: REASON } }, "NotPending");
  const e = await sub("(F5)", 30);
  await waitPastDeadline(e);
  await rejected(`(F5) employer confirms #${e} after deadline`, employer, { confirm: { id: e } }, "DeadlinePassed");
  await ok(`(F5) worker marks #${e} expired`, worker, { mark_expired: { id: e } });
  for (const id of [a, b, c, e]) await query(`record ${id}`, { record: { id } });
}

await query("count (after)", { count: {} });
for (const [n, w] of [["main", main], ["worker", worker], ["employer", employer]])
  log(`balance ${n}(umec)`, (await w.client.getBalance(w.address, config.denom)).amount);
log(`\nresult: ${pass} PASS, ${fail} UNEXPECTED`);
log.save();
process.exit(fail ? 1 : 0);
