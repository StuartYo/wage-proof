// Upload + instantiate the formal WageProof CosmWasm contract on ME testnet (once).
// admin is left empty on purpose: nobody can migrate (change) the contract; a new version means
// a new deployment at a new address. min_employer_level = one.
// Usage: node scripts/cw-deploy.mjs            (refuses if deployments/cw-testnet.json already has wageProof)
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { config, ROOT } from "./lib.mjs";
import { connect, upload, loadDeploy, saveDeploy, logger } from "./cw-lib.mjs";

const log = logger(join(ROOT, "docs", "evidence", "cw-c-deploy.txt"));
const d = loadDeploy();
if (d.wageProof) { console.log("already deployed:", d.wageProof.contract); process.exit(0); }
const file = join(ROOT, "cw", "artifacts", "wage_proof_cw.wasm");
const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
log(`# WageProof CosmWasm deploy ${new Date().toISOString()} chain=${config.cosmosChainId}`);
const { client, address } = await connect();
log("sender", address, "balance(umec)", (await client.getBalance(address, config.denom)).amount);
log("wasm sha256", sha);
const init = { min_employer_level: "one" };
try {
  const u = await upload(client, address, file, "wage-proof-cw v0.2.0", init);
  d.wageProof = { ...u, wasmSha256: sha, initMsg: init, admin: "", deployedAt: new Date().toISOString() };
  saveDeploy(d);
} catch (e) { log("UPLOAD/INSTANTIATE FAILED (raw):", String(e.message ?? e)); log.save(); process.exit(1); }
log("wageProof", d.wageProof);
log("contract info:", await client.getContract(d.wageProof.contract));
log(`verify store tx: ${config.hub.rest}/cosmos/tx/v1beta1/txs/${d.wageProof.storeTx}`);
log(`verify inst tx:  ${config.hub.rest}/cosmos/tx/v1beta1/txs/${d.wageProof.instTx}`);
log(`verify contract: ${config.hub.rest}/cosmwasm/wasm/v1/contract/${d.wageProof.contract}`);
log("balance after(umec)", (await client.getBalance(address, config.denom)).amount);
log.save();
