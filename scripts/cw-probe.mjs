// Stage B: upload + instantiate the probe contract, then query three addresses' ME ID from inside it.
// Usage: node scripts/cw-probe.mjs [--reuse]   (--reuse: skip upload, query the saved contract)
import { join } from "node:path";
import { config, ROOT } from "./lib.mjs";
import { connect, upload, loadDeploy, saveDeploy, logger } from "./cw-lib.mjs";

const log = logger(join(ROOT, "docs", "evidence", "cw-b-probe.txt"));
const TARGETS = [
  ["me1hhqvymvnz5mz3jf5pg4ar4vxhyxsyrqr7tgwyf", "expect KYC_LEVEL_TWO"],
  ["me1me24xy8u2ul9a8zm3y52rcfez0fght8ykq8x9v", "expect KYC_LEVEL_ONE"],
  ["me1mhyngg3dww60msw6dej4mkzheewjck86450e7g", "expect no ME ID -> none"],
];
log(`# Stage B probe ${new Date().toISOString()}  chain=${config.cosmosChainId} rpc=${config.hub.rpc}`);
const { client, address } = await connect();
const bal0 = await client.getBalance(address, config.denom);
log("sender", address, "balance(umec)", bal0.amount);
const d = loadDeploy();
if (!process.argv.includes("--reuse") || !d.probe) {
  try {
    d.probe = await upload(client, address, join(ROOT, "cw", "artifacts", "wage_proof_cw.wasm"), "wage-proof-meid-probe");
    saveDeploy(d);
  } catch (e) { log("UPLOAD/INSTANTIATE FAILED (raw):", String(e.message ?? e)); log.save(); process.exit(1); }
}
log("probe", d.probe);
for (const [addr, note] of TARGETS) {
  try {
    const r = await client.queryContractSmart(d.probe.contract, { me_id: { address: addr } });
    log(`query me_id ${addr} (${note}) ->`, r);
  } catch (e) { log(`query me_id ${addr} (${note}) -> ERROR (raw):`, String(e.message ?? e)); }
}
log("balance after(umec)", (await client.getBalance(address, config.denom)).amount);
log(`verify: ${config.hub.rest}/cosmwasm/wasm/v1/contract/${d.probe.contract}`);
log.save();
