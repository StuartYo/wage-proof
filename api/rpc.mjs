// Read-only JSON-RPC relay: https page -> this function -> ME testnet EVM RPC (plain http).
// Only whitelisted read methods pass. eth_sendRawTransaction and every other method are refused.
import { SETTINGS, json, readCapped } from "./_lib.mjs";

const ALLOWED = new Set(SETTINGS.rpcAllowed);
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function check(call) {
  if (!call || typeof call !== "object" || Array.isArray(call)) return "invalid request object";
  if (call.jsonrpc !== "2.0" || typeof call.method !== "string") return "invalid request object";
  if (!ALLOWED.has(call.method)) return `method not allowed: ${String(call.method).slice(0, 40)}`;
  if (call.params !== undefined && !Array.isArray(call.params)) return "params must be an array";
  if (call.method === "eth_getLogs") {
    const f = call.params?.[0];
    const addr = typeof f?.address === "string" ? f.address.toLowerCase() : "";
    if (addr !== SETTINGS.contract.toLowerCase()) return "eth_getLogs only for the demo contract address";
  }
  return null;
}

export async function POST(request) {
  const { tooBig, text } = await readCapped(request, SETTINGS.rpcMaxBodyBytes);
  if (tooBig) return json(413, rpcErr(null, -32600, `request larger than ${SETTINGS.rpcMaxBodyBytes} bytes`));
  let body;
  try { body = JSON.parse(text); } catch { return json(400, rpcErr(null, -32700, "parse error")); }

  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0) return json(400, rpcErr(null, -32600, "empty batch"));
  if (calls.length > SETTINGS.rpcMaxBatch) return json(400, rpcErr(null, -32600, `batch larger than ${SETTINGS.rpcMaxBatch}`));
  for (const c of calls) {
    const why = check(c);
    if (why) return json(403, Array.isArray(body) ? calls.map((x) => rpcErr(x?.id, -32601, why)) : rpcErr(c?.id, -32601, why));
  }

  try {
    const up = await fetch(SETTINGS.upstreamRpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const out = await up.text();
    return new Response(out, { status: up.ok ? 200 : 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    return json(502, rpcErr(null, -32603, `upstream unreachable: ${e.name}`));
  }
}

export function GET() {
  return json(405, { error: "POST a JSON-RPC request", allowed: SETTINGS.rpcAllowed, maxBatch: SETTINGS.rpcMaxBatch });
}
