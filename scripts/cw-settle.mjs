// Day 6: settlement in MEC. Deploys WageProof CosmWasm v0.3 (claim + settle on confirm) as a NEW contract
// (the code 21 contract and its records stay untouched; admin empty, nobody can migrate either one),
// then runs the settlement flow on ME testnet:
//   worker submits with a claim -> employer underpays / pays nothing (rejected) -> employer confirms with
//   exactly the claim -> worker balance grows by exactly the claim; dispute with coins rejected, dispute
//   without coins pays nothing; claim 0 keeps the v0.2 behaviour.
// Usage: node scripts/cw-settle.mjs            -> docs/evidence/cw-d-deploy.txt + cw-d-e2e.txt
// Keys: main wallet from .env, demo accounts from .env.demo. Never printed.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { toBase64, toUtf8 } from "@cosmjs/encoding";
import { config, ROOT, getJson } from "./lib.mjs";
import { hashReport } from "./hash-report.mjs";
import { connect, broadcast, execMsg, upload, loadDeploy, saveDeploy, logger, readDemoMnemonic } from "./cw-lib.mjs";
import { connectEthKey, readDemoKey } from "./eth-signer.mjs";

const KEY = "wageProofSettle";
const DENOM = config.denom;
// Demo conversion, NOT a real exchange rate: NT$1 = 1,000 umec (1 MEC = 10^8 umec), so NT$523 = 0.00523 MEC.
const UMEC_PER_TWD = 1000;
const REPORT_JSON = JSON.parse(readFileSync(join(ROOT, "demo", "synthetic-report.json"), "utf8"));
const TWD = REPORT_JSON.findings?.[0]?.estimatedShortfallTWD ?? 523;
const CLAIM = String(TWD * UMEC_PER_TWD);
const EMPLOYER_TOPUP = 20_000_000; // 0.2 test MEC, only if the employer has less than 0.3 MEC

const dep = loadDeploy();
const main = await connect();
const worker = await connect(readDemoMnemonic("DEMO_CW_WORKER_MNEMONIC"));
const employer = await connectEthKey(readDemoKey("DEMO_EMPLOYER_KEY"), main.client.registry);
const bal = async (a) => BigInt((await main.client.getBalance(a, DENOM)).amount);
const txUrl = (h) => `${config.hub.rest}/cosmos/tx/v1beta1/txs/${h}`;

// ---------- deploy (once) ----------
const dlog = logger(join(ROOT, "docs", "evidence", "cw-d-deploy.txt"));
if (!dep[KEY]) {
  dlog(`# WageProof CosmWasm v0.3 (settlement) deploy ${new Date().toISOString()} chain=${config.cosmosChainId}`);
  const meta = await getJson(`${config.hub.rest}/cosmos/bank/v1beta1/denoms_metadata`);
  const staking = await getJson(`${config.hub.rest}/cosmos/staking/v1beta1/params`);
  dlog("native coin check: bond_denom =", staking.body?.params?.bond_denom, "; denom metadata =",
    meta.body?.metadatas?.map((m) => ({ base: m.base, display: m.display, units: m.denom_units })));
  const file = join(ROOT, "cw", "artifacts", "wage_proof_cw.wasm");
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  dlog("sender", main.address, "balance(umec)", String(await bal(main.address)));
  dlog("wasm sha256", sha);
  const init = { min_employer_level: "one", settle_denom: DENOM };
  try {
    const u = await upload(main.client, main.address, file, "wage-proof-cw v0.3.0 settlement", init);
    dep[KEY] = { ...u, wasmSha256: sha, initMsg: init, admin: "", deployedAt: new Date().toISOString() };
    saveDeploy(dep);
  } catch (e) { dlog("UPLOAD/INSTANTIATE FAILED (raw):", String(e.message ?? e)); dlog.save(); process.exit(1); }
  dlog(KEY, dep[KEY]);
  dlog("contract info:", await main.client.getContract(dep[KEY].contract));
  dlog(`verify store tx: ${txUrl(dep[KEY].storeTx)}`);
  dlog(`verify inst tx:  ${txUrl(dep[KEY].instTx)}`);
  dlog(`verify contract: ${config.hub.rest}/cosmwasm/wasm/v1/contract/${dep[KEY].contract}`);
  dlog("balance after(umec)", String(await bal(main.address)));
  dlog.save();
}
const C = dep[KEY].contract;

// ---------- e2e ----------
const log = logger(join(ROOT, "docs", "evidence", "cw-d-e2e.txt"));
const smartUrl = (q) => `${config.hub.rest}/cosmwasm/wasm/v1/contract/${C}/smart/${encodeURIComponent(toBase64(toUtf8(JSON.stringify(q))))}`;
let pass = 0, fail = 0;
const check = (ok, what) => { ok ? pass++ : fail++; log(`  ${ok ? "PASS" : "UNEXPECTED"}: ${what}`); };
const q = (msg) => main.client.queryContractSmart(C, msg);
async function query(label, msg) {
  try { const r = await q(msg); log(`query ${label}:`, r); log(`  REST: ${smartUrl(msg)}`); return r; }
  catch (e) { log(`query ${label} ERROR (raw):`, String(e.message ?? e)); return null; }
}
const coinsOf = (amt) => (amt ? [{ denom: DENOM, amount: String(amt) }] : []);
async function ok(label, who, msg, funds = []) {
  const { res, fee } = await broadcast(who.client, who.address, [execMsg(who.address, C, msg, funds)]);
  const ev = Object.fromEntries(res.events.filter((e) => e.type === "wasm").flatMap((e) => e.attributes).map((a) => [a.key, a.value]));
  const transfers = res.events.filter((e) => e.type === "transfer").map((e) => Object.fromEntries(e.attributes.map((a) => [a.key, a.value])));
  log(`TX ${label}: OK hash=${res.transactionHash} height=${res.height} fee=${fee.amount[0].amount}umec funds=${JSON.stringify(funds)}`);
  log(`  wasm event: ${Object.entries(ev).filter(([k]) => k !== "_contract_address").map(([k, v]) => `${k}=${v}`).join(" ")}`);
  log(`  transfer events: ${JSON.stringify(transfers)}`);
  log(`  REST: ${txUrl(res.transactionHash)}`);
  return { ev, res, fee: BigInt(fee.amount[0].amount) };
}
async function rejected(label, who, msg, funds, expect) {
  const m = execMsg(who.address, C, msg, funds);
  let sim = "";
  try { await who.client.simulate(who.address, [m], ""); sim = "(simulate succeeded!)"; }
  catch (e) { sim = String(e.message ?? e); }
  log(`TX ${label}: funds=${JSON.stringify(funds)} expect "${expect}"`);
  log(`  simulate error (raw): ${sim}`);
  const res = await who.client.signAndBroadcast(who.address, [m], { amount: [{ denom: DENOM, amount: config.minFeeUmec }], gas: "500000" }, "");
  log(`  on-chain: code=${res.code} hash=${res.transactionHash} height=${res.height} gasUsed=${res.gasUsed}/500000`);
  log(`  on-chain raw_log: ${res.rawLog}`);
  log(`  REST: ${txUrl(res.transactionHash)}`);
  check(res.code !== 0 && String(res.rawLog).includes(expect) && sim.includes(expect), `${label} rejected with ${expect}`);
  return res;
}

const REPORT = hashReport(join(ROOT, "demo", "synthetic-report.json")).slice(2);
const REASON = createHash("sha256").update("synthetic demo reason: hours on the report do not match the roster").digest("hex");
log(`# WageProof CosmWasm v0.3 settlement e2e ${new Date().toISOString()}`);
log(`chain=${config.cosmosChainId} contract=${C} codeId=${dep[KEY].codeId} (old contract ${dep.wageProof?.contract} untouched)`);
log(`accounts: worker=${worker.address} employer=${employer.address} (old demo employer, EVM key, ethsecp256k1) main=${main.address}`);
log(`report_hash=${REPORT} (sha256 of demo/synthetic-report.json, synthetic data)`);
log(`demo conversion (NOT a real exchange rate): NT$1 = ${UMEC_PER_TWD} umec; NT$${TWD} -> claim ${CLAIM} umec = ${Number(CLAIM) / 1e8} MEC (1 MEC = 10^8 umec)`);
await query("config", { config: {} });
await query("me_id employer", { me_id: { address: employer.address } });

log("\n## (0) employer balance");
let eb = await bal(employer.address);
log(`employer balance ${eb} umec`);
if (eb < 30_000_000n) {
  const { res } = await broadcast(main.client, main.address, [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: { fromAddress: main.address, toAddress: employer.address, amount: coinsOf(EMPLOYER_TOPUP) } }]);
  log(`top-up: main -> employer ${EMPLOYER_TOPUP} umec (test coins only) hash=${res.transactionHash} REST: ${txUrl(res.transactionHash)}`);
  eb = await bal(employer.address);
  log(`employer balance now ${eb} umec`);
}

log("\n## (1) worker submits with a claim");
const s1 = await ok(`(1) worker submit claim=${CLAIM}`, worker, { submit: { report_hash: REPORT, employer: employer.address, deadline_seconds: 3600, claim: CLAIM } });
const a = Number(s1.ev.id);
check(s1.ev.claim === CLAIM, `submit event claim=${s1.ev.claim}`);
await rejected("(1b) worker submit with coins attached", worker,
  { submit: { report_hash: REPORT, employer: employer.address, deadline_seconds: 3600, claim: CLAIM } }, coinsOf(1), "UnexpectedFunds");

log("\n## (2) employer underpays / pays nothing / wrong amount -> rejected, nothing moves");
await rejected(`(2a) employer confirms #${a} paying ${BigInt(CLAIM) - 1n}`, employer, { confirm: { id: a } }, coinsOf(BigInt(CLAIM) - 1n), "WrongSettlement:");
await rejected(`(2b) employer confirms #${a} paying ${BigInt(CLAIM) + 1n}`, employer, { confirm: { id: a } }, coinsOf(BigInt(CLAIM) + 1n), "WrongSettlement:");
await rejected(`(2c) employer confirms #${a} without paying`, employer, { confirm: { id: a } }, [], "SettlementMissing");
const r2 = await query(`record ${a} after rejections`, { record: { id: a } });
check(r2?.status === "pending" && r2?.settled === "0", `record ${a} still pending, settled=${r2?.settled}`);

log("\n## (3) employer confirms paying exactly the claim -> worker receives exactly the claim");
const wb0 = await bal(worker.address), eb0 = await bal(employer.address), cb0 = await bal(C);
log(`before: worker=${wb0} employer=${eb0} contract=${cb0}`);
const c3 = await ok(`(3) employer confirms #${a} paying ${CLAIM}`, employer, { confirm: { id: a } }, coinsOf(CLAIM));
const wb1 = await bal(worker.address), eb1 = await bal(employer.address), cb1 = await bal(C);
log(`after:  worker=${wb1} employer=${eb1} contract=${cb1}`);
check(wb1 - wb0 === BigInt(CLAIM), `worker +${wb1 - wb0} umec (claim ${CLAIM})`);
check(eb0 - eb1 === BigInt(CLAIM) + c3.fee, `employer -${eb0 - eb1} umec = claim ${CLAIM} + fee ${c3.fee}`);
check(cb1 === 0n, `contract keeps nothing (balance ${cb1})`);
check(c3.ev.settled === CLAIM, `confirm event settled=${c3.ev.settled}`);
const r3 = await query(`record ${a}`, { record: { id: a } });
check(r3?.status === "confirmed" && r3?.claim === CLAIM && r3?.settled === CLAIM, `record ${a} confirmed, claim=${r3?.claim} settled=${r3?.settled}`);
await rejected(`(3b) employer confirms #${a} again paying ${CLAIM}`, employer, { confirm: { id: a } }, coinsOf(CLAIM), "NotPending");

log("\n## (4) dispute: coins refused; without coins nothing is paid");
const b = Number((await ok(`(4) worker submit claim=${CLAIM}`, worker, { submit: { report_hash: REPORT, employer: employer.address, deadline_seconds: 3600, claim: CLAIM } })).ev.id);
await rejected(`(4a) employer disputes #${b} with ${CLAIM} attached`, employer, { dispute: { id: b, reason_hash: REASON } }, coinsOf(CLAIM), "UnexpectedFunds");
const wb2 = await bal(worker.address);
const d4 = await ok(`(4b) employer disputes #${b}`, employer, { dispute: { id: b, reason_hash: REASON } });
check(d4.ev.settled === "0" && (await bal(worker.address)) === wb2, `dispute settled=${d4.ev.settled}, worker balance unchanged`);
const r4 = await query(`record ${b}`, { record: { id: b } });
check(r4?.status === "disputed" && r4?.settled === "0", `record ${b} disputed, settled=${r4?.settled}`);

log("\n## (5) claim 0 = v0.2 behaviour: confirm must not carry coins");
const c = Number((await ok("(5) worker submit without claim", worker, { submit: { report_hash: REPORT, employer: employer.address, deadline_seconds: 3600 } })).ev.id);
await rejected(`(5a) employer confirms #${c} with 1 umec attached`, employer, { confirm: { id: c } }, coinsOf(1), "UnexpectedFunds");
const c5 = await ok(`(5b) employer confirms #${c} without coins`, employer, { confirm: { id: c } });
check(c5.ev.claim === "0" && c5.ev.settled === "0", `confirm claim=${c5.ev.claim} settled=${c5.ev.settled}`);

await query("count", { count: {} });
log(`final balances: worker=${await bal(worker.address)} employer=${await bal(employer.address)} contract=${await bal(C)} main=${await bal(main.address)}`);
log(`\nresult: ${pass} PASS, ${fail} UNEXPECTED`);
log.save();
process.exit(fail ? 1 : 0);
