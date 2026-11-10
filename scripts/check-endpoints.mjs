// Read-only connectivity check for every endpoint in config/network.json. No funds needed.
// Writes docs/evidence/endpoints-check.json.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, config, getJson } from "./lib.mjs";

const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, ...detail });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: String(e.cause?.code || e.message || e) });
  }
}
async function rpc(url, method, params = []) {
  const r = await getJson(url, {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (r.status !== 200 || !r.body?.result) throw new Error(`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  return r.body.result;
}

await check("hub REST node_info", async () => {
  const r = await getJson(`${config.hub.rest}/cosmos/base/tendermint/v1beta1/node_info`);
  const n = r.body.default_node_info;
  return { status: r.status, network: n?.network, appVersion: r.body.application_version?.version };
});
await check("hub REST latest block", async () => {
  const r = await getJson(`${config.hub.rest}/cosmos/base/tendermint/v1beta1/blocks/latest`);
  return { status: r.status, height: r.body.block?.header?.height, time: r.body.block?.header?.time };
});
await check("hub RPC /status", async () => {
  const r = await getJson(`${config.hub.rpc}/status`);
  const s = r.body.result;
  return { status: r.status, network: s?.node_info?.network, height: s?.sync_info?.latest_block_height, catchingUp: s?.sync_info?.catching_up };
});
await check("EVM eth_chainId", async () => {
  const hex = await rpc(config.evm.rpc, "eth_chainId");
  const id = parseInt(hex, 16);
  if (id !== config.evm.chainId) throw new Error(`chainId ${id} != expected ${config.evm.chainId}`);
  return { url: config.evm.rpc, chainIdHex: hex, chainId: id };
});
await check("EVM eth_blockNumber", async () => ({ url: config.evm.rpc, blockNumber: parseInt(await rpc(config.evm.rpc, "eth_blockNumber"), 16) }));
await check("EVM gasPrice", async () => ({ gasPriceWei: BigInt(await rpc(config.evm.rpc, "eth_gasPrice")).toString() }));
await check("EVM CORS header (simulated Origin)", async () => {
  const res = await fetch(config.evm.rpc, { method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "content-type": "application/json", origin: "http://localhost:5173" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
  return { accessControlAllowOrigin: res.headers.get("access-control-allow-origin") };
});
for (const url of config.evm.rpcCandidatesHttps) {
  await check(`EVM https candidate ${url}`, async () => ({ chainIdHex: await rpc(url, "eth_chainId") }));
}
await check("hub REST CORS header", async () => {
  const res = await fetch(`${config.hub.rest}/cosmos/base/tendermint/v1beta1/node_info`, { signal: AbortSignal.timeout(20000), headers: { origin: "http://localhost:5173" } });
  return { accessControlAllowOrigin: res.headers.get("access-control-allow-origin") };
});

const out = { checkedAt: new Date().toISOString(), results };
writeFileSync(join(ROOT, "docs", "evidence", "endpoints-check.json"), JSON.stringify(out, null, 2) + "\n");
for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.name} (${r.ms}ms) ${JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !["name", "ok", "ms"].includes(k))))}`);
console.log(`${results.filter(r => r.ok).length}/${results.length} checks ok`);
