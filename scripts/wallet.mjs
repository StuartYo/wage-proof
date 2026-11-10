// Creates a TESTNET-ONLY wallet once. The mnemonic goes to .env (git-ignored) and is never printed.
// Prints only public addresses. Re-running reuses the existing .env.
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Mnemonic, HDNodeWallet, randomBytes } from "ethers";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { stringToPath } from "@cosmjs/crypto";
import { ROOT, config, readMnemonic, evmToBech32 } from "./lib.mjs";

let mnemonic = readMnemonic();
if (!mnemonic) {
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) throw new Error(".env exists but has no TESTNET_MNEMONIC; refusing to overwrite it");
  mnemonic = Mnemonic.fromEntropy(randomBytes(16)).phrase;
  writeFileSync(envPath,
    "# TESTNET ONLY. Never send real assets to these addresses. Never commit this file.\n" +
    `TESTNET_MNEMONIC="${mnemonic}"\n`, { mode: 0o600 });
  console.log("created .env with a new testnet-only mnemonic (not shown)");
}

const cosmos = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
  prefix: config.bech32Prefix, hdPaths: [stringToPath(config.hdPaths.main)],
});
const [{ address: mainAddress }] = await cosmos.getAccounts();
const evm = HDNodeWallet.fromPhrase(mnemonic, undefined, config.hdPaths.evm);

const out = {
  mainAccount_me1: mainAddress,
  evmAccount_0x: evm.address,
  evmAccount_asMe1: evmToBech32(evm.address),
};
console.log(JSON.stringify(out, null, 2));
writeFileSync(join(ROOT, "config", "wallet.public.json"), JSON.stringify({
  _note: "Public addresses of the TESTNET-ONLY demo wallet. No secrets here.",
  ...out,
}, null, 2) + "\n");
