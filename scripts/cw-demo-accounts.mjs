// Creates the two TESTNET-ONLY Cosmos-key demo accounts used by the CosmWasm contract flow
// (worker, employer). Secrets go to .env.demo only (git-ignored); this script prints addresses only.
// Re-running keeps existing accounts (it never overwrites).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { stringToPath } from "@cosmjs/crypto";
import { ROOT, config } from "./lib.mjs";

const file = join(ROOT, ".env.demo");
const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
const out = {};
for (const role of ["WORKER", "EMPLOYER"]) {
  const key = `DEMO_CW_${role}_MNEMONIC`;
  const m = cur.match(new RegExp(`^${key}="?([a-z ]+)"?$`, "m"));
  let wallet;
  const opts = { prefix: config.bech32Prefix, hdPaths: [stringToPath(config.hdPaths.main)] };
  if (m) wallet = await DirectSecp256k1HdWallet.fromMnemonic(m[1].trim(), opts);
  else {
    wallet = await DirectSecp256k1HdWallet.generate(24, opts);
    appendFileSync(file, `${cur.endsWith("\n") || cur === "" ? "" : "\n"}${key}="${wallet.mnemonic}"\n`);
  }
  out[role.toLowerCase()] = (await wallet.getAccounts())[0].address;
}
const pub = join(ROOT, "config", "wallet.cw-demo.public.json");
writeFileSync(pub, JSON.stringify({ _note: "Public addresses of TESTNET-ONLY CosmWasm demo accounts. No secrets here.", ...out }, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
