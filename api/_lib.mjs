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
