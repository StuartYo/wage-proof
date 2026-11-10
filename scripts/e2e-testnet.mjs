// End-to-end run on the ME testnet EVM (chain id 400) with the TESTNET-ONLY demo wallet.
// Worker = EVM account index 0 (the deployer). Employer = index 1 of the same test mnemonic,
// funded here with a little test MEC for gas. Real waiting is used for the expiry path
// (no time travel on a public chain). Every tx hash is printed so it can be checked on chain.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ethers, HDNodeWallet } from "ethers";
import { ROOT, config, readMnemonic } from "./lib.mjs";
import { hashReport } from "./hash-report.mjs";

const rpc = config.evm.rpc ?? config.evm.jsonRpc ?? config.evm.url;
const provider = new ethers.JsonRpcProvider(rpc, config.evm.chainId, { staticNetwork: true });
const mnemonic = readMnemonic();
if (!mnemonic) { console.error("no TESTNET_MNEMONIC in .env"); process.exit(2); }
const basePath = config.hdPaths.evm;                         // m/44'/60'/0'/0/0
const worker = HDNodeWallet.fromPhrase(mnemonic, undefined, basePath).connect(provider);
const employer = HDNodeWallet.fromPhrase(mnemonic, undefined, basePath.replace(/\/0$/, "/1")).connect(provider);
const dep = JSON.parse(readFileSync(join(ROOT, "deployments", "metestnet.json"), "utf8"));
const abi = JSON.parse(readFileSync(join(ROOT, "artifacts/contracts/WageProof.sol/WageProof.json"), "utf8")).abi;
const c = new ethers.Contract(dep.address, abi, provider);
const LABEL = ["None", "Pending", "Confirmed", "Disputed", "Expired"];
const h = hashReport(join(ROOT, "demo", "synthetic-report.json"));
const st = async (id) => LABEL[Number(await c.effectiveStatus(id))];
const out = { contract: dep.address, chainId: config.evm.chainId, worker: worker.address, employer: employer.address, reportHash: h, steps: [] };
const log = (step, extra) => { out.steps.push({ step, ...extra }); console.log(step, JSON.stringify(extra)); };
const send = async (label, txp) => { const tx = await txp; const rc = await tx.wait(); log(label, { tx: tx.hash, block: rc.blockNumber, status: rc.status }); return rc; };

const need = ethers.parseEther("0.05");
if ((await provider.getBalance(employer.address)) < need / 2n) {
  await send("fund employer 0.05 MEC", worker.sendTransaction({ to: employer.address, value: need }));
}
const submit = async (secs, label) => {
  await send(label, c.connect(worker).submit(h, employer.address, secs));
  return Number(await c.recordCount());
};

const a = await submit(3600, "submit A (1h window)");
await send(`confirm #${a}`, c.connect(employer).confirm(a));
log(`status #${a}`, { status: await st(a) });

const b = await submit(3600, "submit B (1h window)");
await send(`dispute #${b}`, c.connect(employer).dispute(b, ethers.sha256(ethers.toUtf8Bytes("synthetic reason"))));
log(`status #${b}`, { status: await st(b) });

const d = await submit(30, "submit C (30s window)");
try { await c.connect(worker).confirm.staticCall(d); log(`BUG worker could confirm #${d}`, {}); }
catch (e) { log(`worker tries confirm #${d}`, { rejected: e.revert?.name ?? String(e.shortMessage ?? e.message).slice(0, 80) }); }
console.log("waiting 45s for the 30s window to pass …");
await new Promise((r) => setTimeout(r, 45000));
log(`status #${d} after wait`, { status: await st(d) });
try { await c.connect(employer).confirm.staticCall(d); log(`BUG late confirm accepted #${d}`, {}); }
catch (e) { log(`late confirm #${d}`, { rejected: e.revert?.name ?? String(e.shortMessage ?? e.message).slice(0, 80) }); }
await send(`markExpired #${d}`, c.connect(employer).markExpired(d));
log(`stored status #${d}`, { status: LABEL[Number((await c.getRecord(d)).status)] });
log("ids for report", { ids: [...(await c.idsForReport(h))].map(Number) });
console.log("\nRESULT " + JSON.stringify(out, null, 2));
