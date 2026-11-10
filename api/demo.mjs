// Server-signed demo actions, so a judge needs no wallet and no test coins.
// Exactly four actions: submit / confirm / dispute / markExpired. Contract address, chain id,
// gas limits and the two signer accounts are fixed on the server. Whether an action is allowed
// (who, which state, which deadline) is decided ONLY by the contract: we simulate the call,
// and if the contract rejects it we return the contract's error name without sending.
//
// Abuse limits are in memory (per server instance): they reset on a cold start and are not
// shared between instances. See docs/day2-online-demo.md.
import { ethers } from "ethers";
import { SETTINGS, ABI, STATUS, verifyUrl, clientIp, json, readCapped } from "./_lib.mjs";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const iface = new ethers.Interface(ABI);
const provider = new ethers.JsonRpcProvider(SETTINGS.upstreamRpc, SETTINGS.chainId, { staticNetwork: true, batchMaxCount: 1 });

let signers = null;
function getSigners() {
  if (signers) return signers;
  const w = process.env.DEMO_WORKER_KEY, e = process.env.DEMO_EMPLOYER_KEY;
  if (!w || !e) return null;
  signers = { worker: new ethers.Wallet(w, provider), employer: new ethers.Wallet(e, provider) };
  return signers;
}

// ---- in-memory limits ----
const perIp = new Map();               // ip -> [timestamps ms]
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

// one queue per signer inside this instance, so two requests do not race for the same nonce
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
      return { who: "worker", fn: "submit", args: (s) => [b.reportHash, s.employer.address, secs] };
    }
    case "confirm":
      if (!idOk) return { error: "id must be a positive integer" };
      return { who: "employer", fn: "confirm", args: () => [id] };
    case "dispute":
      if (!idOk) return { error: "id must be a positive integer" };
      if (typeof b.reasonHash !== "string" || !HEX32.test(b.reasonHash)) return { error: "reasonHash must be 0x + 64 hex" };
      return { who: "employer", fn: "dispute", args: () => [id, b.reasonHash] };
    case "markExpired":
      if (!idOk) return { error: "id must be a positive integer" };
      return { who: "worker", fn: "markExpired", args: () => [id] };
    default:
      return { error: "action must be submit | confirm | dispute | markExpired" };
  }
}

function revertName(e) {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data === "string" && data.startsWith("0x")) {
    try { const d = iface.parseError(data); if (d) return d.name; } catch {}
  }
  return e?.revert?.name || e?.shortMessage || String(e?.message || e).slice(0, 120);
}

export async function GET() {
  const s = getSigners();
  return json(200, {
    chainId: SETTINGS.chainId, contract: SETTINGS.contract, hubRest: SETTINGS.hubRest,
    worker: s?.worker.address ?? null, employer: s?.employer.address ?? null,
    windows: SETTINGS.allowedWindows, abi: ABI,
    limits: { writesPerIpPerMinute: SETTINGS.writesPerIpPerMinute, writesPerDay: SETTINGS.writesPerDay, note: "in-memory, per server instance; resets on cold start" },
  });
}

export async function POST(request) {
  const { tooBig, text } = await readCapped(request, SETTINGS.demoMaxBodyBytes);
  if (tooBig) return json(413, { ok: false, code: "too_large", message: "request too large" });
  let body;
  try { body = JSON.parse(text); } catch { return json(400, { ok: false, code: "bad_json", message: "invalid JSON" }); }
  const act = parseAction(body);
  if (act.error) return json(400, { ok: false, code: "bad_request", message: act.error });

  const s = getSigners();
  if (!s) return json(503, { ok: false, code: "not_configured", message: "示範帳號未設定（demo signer not configured）" });

  const q = takeQuota(clientIp(request));
  if (!q.ok) return json(429, { ok: false, code: q.code, message: q.message }, q.retryAfter ? { "retry-after": String(q.retryAfter) } : {});

  const signer = s[act.who];
  const contract = new ethers.Contract(SETTINGS.contract, ABI, signer);
  const args = act.args(s);

  try {
    return await serial(act.who, async () => {
      const bal = await provider.getBalance(signer.address);
      if (bal < SETTINGS.minBalanceWei) {
        return json(503, { ok: false, code: "out_of_funds", message: "示範額度用完（demo test coins used up）", signer: signer.address });
      }
      // the contract decides: simulate first, send only if the contract would accept it
      try { await contract[act.fn].staticCall(...args); }
      catch (e) { return json(409, { ok: false, code: "contract_rejected", action: body.action, contractError: revertName(e), message: `合約拒絕：${revertName(e)}` }); }

      const tx = await contract[act.fn](...args, {
        gasLimit: SETTINGS.gasLimit[act.fn],
        maxFeePerGas: SETTINGS.maxFeePerGasWei,
        maxPriorityFeePerGas: 0n,
      });
      const rc = await tx.wait(1, SETTINGS.receiptWaitMs).catch(() => null);
      const out = { ok: true, action: body.action, signer: signer.address, txHash: tx.hash, verifyUrl: verifyUrl(tx.hash) };
      if (!rc) return json(202, { ...out, receipt: "pending", message: "交易已送出，尚未出塊" });
      out.blockNumber = rc.blockNumber;
      out.receiptStatus = rc.status;
      let id = body.id;
      if (act.fn === "submit") {
        for (const l of rc.logs) {
          try { const ev = iface.parseLog(l); if (ev?.name === "Submitted") id = Number(ev.args.id); } catch {}
        }
      }
      out.id = id;
      if (id) out.status = STATUS[Number(await contract.effectiveStatus(id))];
      return json(200, out);
    });
  } catch (e) {
    return json(502, { ok: false, code: "upstream_error", message: String(e?.shortMessage || e?.message || e).slice(0, 160) });
  }
}
