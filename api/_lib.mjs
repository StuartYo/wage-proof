// Shared server-side settings for the online demo (Vercel functions).
// Everything a caller could abuse is fixed here: upstream RPC, chain id, contract address,
// gas limits, rate limits. Callers can never choose them.
// Files starting with "_" inside api/ are not exposed as endpoints by Vercel.

export const SETTINGS = Object.freeze({
  upstreamRpc: "http://118.175.0.249:8545",          // ME testnet EVM JSON-RPC (plain http, bare IP)
  chainId: 400,
  chainIdHex: "0x190",
  contract: "0x07C06de8D0D593E45Fa4f16bF4B7D82d96D723E0",
  hubRest: "https://beta-hub-1317.explorer-testnet.me",
  // rpc relay
  rpcMaxBodyBytes: 8 * 1024,
  rpcMaxBatch: 10,
  rpcAllowed: [
    "eth_chainId", "eth_blockNumber", "eth_call", "eth_getTransactionReceipt",
    "eth_getTransactionByHash", "eth_getLogs", "eth_getBlockByNumber", "eth_getCode", "eth_getBalance",
  ],
  // demo writes
  demoMaxBodyBytes: 1024,
  allowedWindows: [30, 60, 3600],                     // seconds
  writesPerIpPerMinute: 6,
  writesPerDay: 300,                                  // whole site, per server instance (in memory)
  minBalanceWei: 10n ** 16n,                          // 0.01 test MEC: below this the demo stops sending
  gasLimit: { submit: 260000n, confirm: 90000n, dispute: 110000n, markExpired: 90000n },
  maxFeePerGasWei: 10n ** 9n,                         // hard cap; testnet asks ~7 wei
  receiptWaitMs: 40000,
  // ME ID (real-person) gate for submit. Levels: none < one (Real-Person Verification) < two (Advanced Verification).
  // The employer of a new record must be at least this level, otherwise nothing is sent.
  minEmployerLevel: "one",
  meIdCacheMs: 30000,
  meIdTimeoutMs: 8000,
  // The only employers a caller may pick. "verified" = the demo employer signer (address read from the key at runtime).
  // "unverified" = a fixed random testnet address with no ME ID (no private key exists for it anywhere;
  // generated 2026-11-11 and checked: Hub answers "DID not found").
  unverifiedEmployer: "0xDdC934222D73b4Fdc1dA6e655dd857Ce5d2C58fa",
});

export const ABI = [
  "function recordCount() view returns (uint256)",
  "function getRecord(uint256 id) view returns (tuple(address worker, address employer, bytes32 reportHash, bytes32 reasonHash, uint64 submittedAt, uint64 deadline, uint64 closedAt, uint8 status))",
  "function effectiveStatus(uint256 id) view returns (uint8)",
  "function submit(bytes32 reportHash, address employer, uint64 deadlineSeconds) returns (uint256)",
  "function confirm(uint256 id)",
  "function dispute(uint256 id, bytes32 reasonHash)",
  "function markExpired(uint256 id)",
  "event Submitted(uint256 indexed id, address indexed worker, address indexed employer, bytes32 reportHash, uint64 deadline)",
  "event Confirmed(uint256 indexed id, address indexed employer, uint64 at)",
  "event Disputed(uint256 indexed id, address indexed employer, bytes32 reasonHash, uint64 at)",
  "event Expired(uint256 indexed id, address indexed caller, uint64 at)",
  "error ZeroHash()",
  "error BadEmployer()",
  "error BadWindow(uint64 given, uint64 min, uint64 max)",
  "error NoSuchRecord(uint256 id)",
  "error NotEmployer(address caller, address employer)",
  "error NotPending(uint8 status)",
  "error DeadlinePassed(uint64 deadline, uint64 nowTs)",
  "error DeadlineNotPassed(uint64 deadline, uint64 nowTs)",
];

export const STATUS = ["None", "Pending", "Confirmed", "Disputed", "Expired"];

export function verifyUrl(ethTxHash) {
  const q = encodeURIComponent(`ethereum_tx.ethereumTxHash='${ethTxHash}'`);
  return `${SETTINGS.hubRest}/cosmos/tx/v1beta1/txs?events=${q}`;
}

export function clientIp(request) {
  const h = request.headers;
  return (h.get("x-real-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || "unknown").trim();
}

export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

// Read the body with a hard size cap (do not trust content-length alone).
export async function readCapped(request, max) {
  const cl = Number(request.headers.get("content-length") || 0);
  if (cl > max) return { tooBig: true };
  const buf = await request.arrayBuffer();
  if (buf.byteLength > max) return { tooBig: true };
  return { text: new TextDecoder().decode(buf) };
}

// ---------------- ME ID level lookup (read-only, Hub REST) ----------------
// The EVM side of ME Hub cannot read the identity module (no precompile; see docs/day3-meid.md),
// so the server reads it from the Hub REST API before sending a transaction.
//
// meIdLevel(address) -> one of
//   { ok: true,  level: "none" | "one" | "two", kycLevel, status, did, me1, queryUrl, checkedAt, cached }
//   { ok: false, code: "meid_lookup_failed", message, httpStatus, me1, queryUrl }
// An upstream failure is NEVER reported as "has" or "has not": callers must treat ok:false as "unknown".
// Only a DID with status DID_STATUS_ACTIVE counts; an unrecognised kycLevel counts as "none" (conservative).

export const LEVEL_RANK = { none: 0, one: 1, two: 2 };
const KYC_MAP = { KYC_LEVEL_ONE: "one", KYC_LEVEL_TWO: "two" };
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
  }
  return chk;
}
// 0x address -> me1 address (same 20 bytes, bech32 with prefix "me")
export function evmToMe1(evm, prefix = "me") {
  const bytes = evm.slice(2).match(/../g).map((h) => parseInt(h, 16));
  const words = []; let acc = 0, bits = 0;
  for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; words.push((acc >>> bits) & 31); } }
  if (bits) words.push((acc << (5 - bits)) & 31);
  const hrp = [...prefix].map((c) => c.charCodeAt(0));
  const pm = bech32Polymod([...hrp.map((c) => c >> 5), 0, ...hrp.map((c) => c & 31), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const chk = [0, 1, 2, 3, 4, 5].map((i) => (pm >>> (5 * (5 - i))) & 31);
  return prefix + "1" + [...words, ...chk].map((w) => BECH32[w]).join("");
}

export function meIdQueryUrl(me1, hubRest = SETTINGS.hubRest) {
  return `${hubRest}/metaearth/did/did?address=${encodeURIComponent(me1)}`;
}

const meIdCache = new Map(); // me1 -> { at, result }   (only successful lookups are cached)

export async function meIdLevel(address, opts = {}) {
  const hubRest = opts.hubRest ?? SETTINGS.hubRest;
  const doFetch = opts.fetch ?? fetch;
  let me1;
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) me1 = evmToMe1(address);
  else if (/^me1[02-9ac-hj-np-z]{38}$/.test(address)) me1 = address;
  else return { ok: false, code: "bad_address", message: "address must be 0x + 40 hex or me1…", input: address };
  const queryUrl = meIdQueryUrl(me1, hubRest);

  const hit = meIdCache.get(me1);
  if (!opts.noCache && hit && Date.now() - hit.at < SETTINGS.meIdCacheMs) return { ...hit.result, cached: true };

  const fail = (message, httpStatus = null) => ({ ok: false, code: "meid_lookup_failed", message, httpStatus, me1, queryUrl });
  let res, text;
  try {
    res = await doFetch(queryUrl, { signal: AbortSignal.timeout(SETTINGS.meIdTimeoutMs), headers: { accept: "application/json" } });
    text = await res.text();
  } catch (e) {
    return fail(`Hub unreachable: ${String(e?.message || e).slice(0, 120)}`);
  }
  let body = null;
  try { body = JSON.parse(text); } catch {}
  const info = body && typeof body === "object" ? body.info : null;
  let result;
  if (res.status === 200 && info && typeof info.did === "string" && info.did) {
    const active = info.status === "DID_STATUS_ACTIVE";
    result = { level: active ? (KYC_MAP[info.kycLevel] ?? "none") : "none", kycLevel: info.kycLevel ?? null, status: info.status ?? null, did: info.did };
  } else if (body && typeof body.message === "string" && body.message.includes("DID not found")) {
    result = { level: "none", kycLevel: null, status: "DID not found", did: null };
  } else {
    return fail(`unexpected Hub answer HTTP ${res.status}: ${String(body?.message ?? text ?? "").slice(0, 120)}`, res.status);
  }
  result = { ok: true, ...result, me1, queryUrl, checkedAt: new Date().toISOString() };
  meIdCache.set(me1, { at: Date.now(), result });
  if (meIdCache.size > 2000) meIdCache.clear();
  return { ...result, cached: false };
}
