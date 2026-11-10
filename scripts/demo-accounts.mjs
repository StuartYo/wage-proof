// Online-demo accounts (TESTNET ONLY, test coins have no value).
// Creates two NEW random EVM accounts used only by the public demo server (api/demo):
//   worker   -> signs submit / markExpired
//   employer -> signs confirm / dispute
// Private keys are written ONLY to .env.demo (git-ignored). This script never prints a key.
//
//   node scripts/demo-accounts.mjs            create .env.demo (refuses if it exists)
//   node scripts/demo-accounts.mjs --rotate   throw away the old pair and create a new one
//   node scripts/demo-accounts.mjs --fund 0.2 send 0.2 test MEC to each, from the deployer (.env mnemonic)
//   node scripts/demo-accounts.mjs --show     print addresses and balances only
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ethers, HDNodeWallet, Wallet } from "ethers";
import { ROOT, config, readMnemonic } from "./lib.mjs";

const ENV = join(ROOT, ".env.demo");
const PUB = join(ROOT, "config", "demo-accounts.public.json");
const args = process.argv.slice(2);
const provider = new ethers.JsonRpcProvider(config.evm.rpc, config.evm.chainId, { staticNetwork: true });

function readKeys() {
  const t = readFileSync(ENV, "utf8");
  const get = (k) => (t.match(new RegExp(`^${k}=(0x[0-9a-fA-F]{64})\\s*$`, "m")) || [])[1];
  return { worker: get("DEMO_WORKER_KEY"), employer: get("DEMO_EMPLOYER_KEY") };
}

if (!existsSync(ENV) || args.includes("--rotate")) {
  const w = Wallet.createRandom(), e = Wallet.createRandom();
  writeFileSync(ENV,
    "# Online demo accounts. ME TESTNET ONLY. Test coins only. Never commit. Rotate any time:\n" +
    "#   node scripts/demo-accounts.mjs --rotate\n" +
    `DEMO_WORKER_KEY=${w.privateKey}\nDEMO_EMPLOYER_KEY=${e.privateKey}\n`, { mode: 0o600 });
  writeFileSync(PUB, JSON.stringify({
    _note: "Public addresses of the online-demo signer accounts (ME testnet only, test coins only). Keys live in .env.demo and in Vercel env vars, never in git.",
    worker: w.address, employer: e.address, createdAt: new Date().toISOString(),
  }, null, 2) + "\n");
  console.log(`created .env.demo\nworker   ${w.address}\nemployer ${e.address}`);
}

const k = readKeys();
const worker = new Wallet(k.worker, provider), employer = new Wallet(k.employer, provider);

const fi = args.indexOf("--fund");
if (fi >= 0) {
  const amount = ethers.parseEther(args[fi + 1] || "0.2");
  const m = readMnemonic();
  if (!m) { console.error("no TESTNET_MNEMONIC in .env"); process.exit(2); }
  const funder = HDNodeWallet.fromPhrase(m, undefined, config.hdPaths.evm).connect(provider);
  for (const [name, to] of [["worker", worker.address], ["employer", employer.address]]) {
    const tx = await funder.sendTransaction({ to, value: amount });
    const rc = await tx.wait();
    console.log(`fund ${name} ${ethers.formatEther(amount)} MEC tx ${tx.hash} block ${rc.blockNumber} status ${rc.status}`);
  }
  console.log(`funder ${funder.address} left ${ethers.formatEther(await provider.getBalance(funder.address))} MEC`);
}

for (const [name, w] of [["worker", worker], ["employer", employer]]) {
  console.log(`${name.padEnd(8)} ${w.address} ${ethers.formatEther(await provider.getBalance(w.address))} MEC`);
}
