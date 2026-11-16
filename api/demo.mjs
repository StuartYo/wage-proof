// Server-signed demo actions on the CosmWasm WageProof contract, so a judge needs no wallet and no test coins.
// Exactly four actions: submit / confirm / dispute / markExpired. Contract address, chain and the two signer
// accounts are fixed on the server. Whether an action is allowed (who, which state, which deadline, and
// whether the employer holds an ME ID) is decided ONLY by the contract: we simulate the call on the chain
// node, and if the contract rejects it we return the contract's error name without sending.
// The ME ID rule lives inside the contract (it queries the ME ID module itself), not on this server.
// Settlement (contract v0.3): submit carries the worker's claim (NT$ turned into umec with the demo conversion
// CW.umecPerTwd, NOT a real exchange rate); confirm attaches exactly the claim stored in the record, and the
// contract forwards it to the worker in the same transaction. Wrong or missing payment is refused by the contract.
//
// Abuse limits are in memory (per server instance): they reset on a cold start and are not
// shared between instances. See docs/day2-online-demo.md.
import { SETTINGS, clientIp, json, readCapped } from "./_lib.mjs";
import { CW, txUrl, connectMnemonic, connectEthKey, contractErrorName, feeForGas } from "./_cwbundle.mjs";

const LEVEL_LABEL = { none: "未驗證 None", one: "真人驗證 Real-person", two: "進階驗證 Advanced" };
const EMPLOYER_CHOICES = ["verified", "unverified"];
const UNVERIFIED = "me1mhyngg3dww60msw6dej4mkzheewjck86450e7g"; // no key exists for it; Hub answers "DID not found"
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const MIN_BALANCE_UMEC = 200000n;   // below this the demo stops sending (plus the claim on a paying confirm)
const MAX_CLAIM_TWD = 5000;         // demo cap: at most 0.05 MEC per record

let signersP = null;
function getSigners() {
  const m = process.env.DEMO_CW_WORKER_MNEMONIC, e = process.env.DEMO_EMPLOYER_KEY;
  if (!m || !e) return null;
  if (!signersP) {
    signersP = (async () => {
      const worker = await connectMnemonic(m.trim());
      const employer = await connectEthKey(e.trim(), worker.registry);
      return { worker, employer };
    })().catch((err) => { signersP = null; throw err; });
  }
  return signersP;
}

// ---- in-memory limits ----
const perIp = new Map();
let day = "", dayCount = 0;
function takeQuota(ip) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; }
  if (dayCount >= SETTINGS.writesPerDay) return { ok: false, code: "daily_limit", message: `今日示範寫入已達上限 ${SETTINGS.writesPerDay} 次（Daily demo limit reached）` };
  const list = (perIp.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= SETTINGS.writesPerIpPerMinute) {
    perIp.set(ip, list);
    const wait = Math.ceil((60000 - (now - list[0])) / 1000);
    return { ok: false, code: "rate_limited", message: `同一來源每分鐘最多 ${SETTINGS.writesPerIpPerMinute} 次寫入，請 ${wait} 秒後再試（Rate limited）`, retryAfter: wait };
  }
  list.push(now); perIp.set(ip, list); dayCount++;
  if (perIp.size > 5000) for (const [k, v] of perIp) if (!v.some((t) => now - t < 60000)) perIp.delete(k);
  return { ok: true };
}

// one queue per signer inside this instance, so two requests do not race for the same sequence number
const queues = { worker: Promise.resolve(), employer: Promise.resolve() };
function serial(who, fn) {
  const run = queues[who].then(fn, fn);
  queues[who] = run.catch(() => {});
  return run;
}

function parseAction(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return { error: "body must be a JSON object" };
  const id = b.id;
  const idOk = Number.isSafeInteger(id) && id >= 1 && id <= 1e9;
  switch (b.action) {
    case "submit": {
      const secs = Number(b.deadlineSeconds);
      if (typeof b.reportHash !== "string" || !HEX32.test(b.reportHash)) return { error: "reportHash must be 0x + 64 hex" };
      if (!SETTINGS.allowedWindows.includes(secs)) return { error: `deadlineSeconds must be one of ${SETTINGS.allowedWindows.join("/")}` };
      const choice = b.employer === undefined ? "verified" : b.employer;
      if (!EMPLOYER_CHOICES.includes(choice)) return { error: `employer must be one of ${EMPLOYER_CHOICES.join("/")}` };
      const twd = b.claimTwd === undefined ? 0 : b.claimTwd;
      if (!Number.isSafeInteger(twd) || twd < 0 || twd > MAX_CLAIM_TWD) return { error: `claimTwd must be an integer 0..${MAX_CLAIM_TWD}` };
      const claim = String(BigInt(twd) * BigInt(CW.umecPerTwd));
      return { who: "worker", employerChoice: choice, claimTwd: twd, claim,
        msg: (s) => ({ submit: { report_hash: b.reportHash.slice(2).toLowerCase(), employer: choice === "verified" ? s.employer.address : UNVERIFIED, deadline_seconds: secs, claim } }) };
    }
    case "confirm":
      if (!idOk) return { error: "id must be a positive integer" };
      return { who: "employer", msg: () => ({ confirm: { id } }) };
    case "dispute":
      if (!idOk) return { error: "id must be a positive integer" };
      if (typeof b.reasonHash !== "string" || !HEX32.test(b.reasonHash)) return { error: "reasonHash must be 0x + 64 hex" };
      return { who: "employer", msg: () => ({ dispute: { id, reason_hash: b.reasonHash.slice(2).toLowerCase() } }) };
    case "markExpired":
      if (!idOk) return { error: "id must be a positive integer" };
      return { who: "worker", msg: () => ({ mark_expired: { id } }) };
    default:
      return { error: "action must be submit | confirm | dispute | markExpired" };
  }
}

const execMsg = (sender, msg, funds = []) => ({ typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
  value: { sender, contract: CW.contract, msg: new TextEncoder().encode(JSON.stringify(msg)), funds } });

// the contract's own view of an address's ME ID (it calls the ME ID module on chain)
async function meIdView(client, address) {
  try {
    const r = await client.queryContractSmart(CW.contract, { me_id: { address } });
    return { ok: true, address, level: r.level, label: LEVEL_LABEL[r.level] ?? r.level, kycLevel: r.kyc_level || null,
      status: r.status || (r.source === "not_found" ? "DID not found" : null), did: r.did || null, source: r.source,
      queryUrl: `${CW.rest}/metaearth/did/did?address=${address}`, checkedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, address, message: String(e?.message || e).slice(0, 160), queryUrl: `${CW.rest}/metaearth/did/did?address=${address}` };
  }
}

export async function GET() {
  let s = null, err = null;
  try { s = await getSigners(); } catch (e) { err = String(e?.message || e).slice(0, 120); }
  let minEmployerLevel = "one";
  try { if (s) minEmployerLevel = (await s.worker.client.queryContractSmart(CW.contract, { config: {} })).min_employer_level; } catch {}
  return json(200, {
    network: "cosmwasm", chainId: CW.chainId, contract: CW.contract, codeId: CW.codeId, hubRest: CW.rest,
    storeTx: CW.storeTx, instTx: CW.instTx, rejectProofTx: CW.rejectProofTx,
    settle: { denom: CW.denom, umecPerTwd: CW.umecPerTwd, mecDecimals: CW.mecDecimals, maxClaimTwd: MAX_CLAIM_TWD, note: "demo conversion, not a real exchange rate" },
    legacy: { contract: CW.legacyContract, codeId: CW.legacyCodeId },
    worker: s?.worker.address ?? null, employer: s?.employer.address ?? null,
    employers: s ? { verified: s.employer.address, unverified: UNVERIFIED } : null,
    windows: SETTINGS.allowedWindows, minEmployerLevel,
    limits: { writesPerIpPerMinute: SETTINGS.writesPerIpPerMinute, writesPerDay: SETTINGS.writesPerDay, note: "in-memory, per server instance; resets on cold start" },
    ...(err ? { signerError: err } : {}),
  });
}

export async function POST(request) {
  const { tooBig, text } = await readCapped(request, SETTINGS.demoMaxBodyBytes);
  if (tooBig) return json(413, { ok: false, code: "too_large", message: "request too large" });
  let body;
  try { body = JSON.parse(text); } catch { return json(400, { ok: false, code: "bad_json", message: "invalid JSON" }); }
  const act = parseAction(body);
  if (act.error) return json(400, { ok: false, code: "bad_request", message: act.error });

  let s;
  try { s = await getSigners(); } catch (e) { return json(502, { ok: false, code: "upstream_error", message: String(e?.message || e).slice(0, 160) }); }
  if (!s) return json(503, { ok: false, code: "not_configured", message: "示範帳號未設定（demo signer not configured）" });

  const q = takeQuota(clientIp(request));
  if (!q.ok) return json(429, { ok: false, code: q.code, message: q.message }, q.retryAfter ? { "retry-after": String(q.retryAfter) } : {});

  const signer = s[act.who];
  const msg = act.msg(s);
  // confirm pays exactly the claim the contract stored; the contract checks the amount again
  let funds = [], claim = "0";
  if (body.action === "confirm") {
    try { claim = String((await s.worker.client.queryContractSmart(CW.contract, { record: { id: body.id } })).claim ?? "0"); }
    catch (e) {
      const name = contractErrorName(e);
      if (name) return json(409, { ok: false, code: "contract_rejected", action: body.action, sent: false, contractError: name, message: `合約拒絕：${name}` });
      return json(502, { ok: false, code: "upstream_error", message: String(e?.message || e).slice(0, 160) });
    }
    if (claim !== "0") funds = [{ denom: CW.denom, amount: claim }];
  }
  const m = execMsg(signer.address, msg, funds);

  // submit: show what the CONTRACT sees for both parties (display only; the contract enforces the rule)
  let meId = null;
  if (body.action === "submit") {
    const [emp, wrk, cfg] = await Promise.all([meIdView(s.worker.client, msg.submit.employer), meIdView(s.worker.client, s.worker.address),
      s.worker.client.queryContractSmart(CW.contract, { config: {} }).catch(() => null)]);
    const min = cfg?.min_employer_level ?? "one";
    meId = { rule: `contract: employer ME ID level >= ${min}`, enforcedBy: "contract", minEmployerLevel: min,
      employer: { choice: act.employerChoice, ...emp }, worker: wrk };
  }

  try {
    return await serial(act.who, async () => {
      const bal = BigInt((await signer.client.getBalance(signer.address, CW.denom)).amount);
      if (bal < MIN_BALANCE_UMEC + BigInt(claim)) return json(503, { ok: false, code: "out_of_funds", message: "示範額度用完（demo test coins used up）", signer: signer.address });

      // the contract decides: simulate on the chain node first, send only if the contract would accept it
      let gas;
      try { gas = await signer.client.simulate(signer.address, [m], ""); }
      catch (e) {
        const name = contractErrorName(e);
        if (!name) return json(502, { ok: false, code: "upstream_error", message: String(e?.message || e).slice(0, 160) });
        const detail = (String(e.message).match(/Generic error: (.*?): execute wasm contract failed/) || [])[1] || name;
        const code = name === "EmployerNotVerified" ? "employer_not_verified" : "contract_rejected";
        return json(code === "employer_not_verified" ? 403 : 409, { ok: false, code, action: body.action, sent: false,
          contractError: name, contractMessage: detail, message: `合約拒絕：${name}`, rejectProofUrl: txUrl(CW.rejectProofTx), ...(meId ? { meId } : {}) });
      }

      const res = await signer.client.signAndBroadcast(signer.address, [m], feeForGas(Math.ceil(gas * 1.4)), "");
      const out = { ok: res.code === 0, action: body.action, signer: signer.address, txHash: res.transactionHash, verifyUrl: txUrl(res.transactionHash), blockNumber: res.height };
      if (meId) out.meId = meId;
      if (res.code !== 0) return json(409, { ...out, code: "contract_rejected", contractError: contractErrorName({ message: res.rawLog }), message: String(res.rawLog).slice(0, 200) });
      const wasm = Object.fromEntries((res.events || []).filter((e) => e.type === "wasm").flatMap((e) => e.attributes).map((a) => [a.key, a.value]));
      const id = Number(wasm.id ?? body.id);
      out.id = id;
      if (wasm.employer_level) out.levelsStoredOnChain = { employer: wasm.employer_level, worker: wasm.worker_level };
      if (wasm.claim !== undefined) out.claim = wasm.claim;
      if (wasm.settled !== undefined) out.settled = wasm.settled;
      if (body.action === "submit") out.claimTwd = act.claimTwd;
      try { out.status = await s.worker.client.queryContractSmart(CW.contract, { effective_status: { id } }); } catch {}
      return json(200, out);
    });
  } catch (e) {
    return json(502, { ok: false, code: "upstream_error", message: String(e?.shortMessage || e?.message || e).slice(0, 160) });
  }
}
