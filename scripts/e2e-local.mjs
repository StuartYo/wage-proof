// End-to-end run against a running local Hardhat node (same calls the demo page makes).
// Needs: `npx hardhat node` and `npm run deploy:local`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "ethers";
import { ROOT } from "./lib.mjs";
import { hashReport } from "./hash-report.mjs";

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const worker = await provider.getSigner(0);
const employer = await provider.getSigner(1);
const dep = JSON.parse(readFileSync(join(ROOT, "deployments", "localhost.json"), "utf8"));
const abi = JSON.parse(readFileSync(join(ROOT, "artifacts/contracts/WageProof.sol/WageProof.json"), "utf8")).abi;
const c = new ethers.Contract(dep.address, abi, provider);
const LABEL = ["None", "Pending", "Confirmed", "Disputed", "Expired"];
const h = hashReport(join(ROOT, "demo", "synthetic-report.json"));
const st = async (id) => LABEL[Number(await c.effectiveStatus(id))];

async function submit(secs) {
  const rc = await (await c.connect(worker).submit(h, await employer.getAddress(), secs)).wait();
  return Number(await c.recordCount());
}
const a = await submit(60);
await (await c.connect(employer).confirm(a)).wait();
console.log(`#${a} confirm path -> ${await st(a)}`);

const b = await submit(60);
await (await c.connect(employer).dispute(b, ethers.sha256(ethers.toUtf8Bytes("synthetic reason")))).wait();
console.log(`#${b} dispute path -> ${await st(b)}`);

const d = await submit(30);
try { await c.connect(worker).confirm.staticCall(d); console.log("BUG: worker could confirm"); }
catch (e) { console.log(`#${d} worker tries confirm -> rejected (${e.revert?.name})`); }
await provider.send("evm_increaseTime", [31]); await provider.send("evm_mine", []);
console.log(`#${d} after 31s -> effective ${await st(d)}`);
try { await c.connect(employer).confirm.staticCall(d); console.log("BUG: late confirm accepted"); }
catch (e) { console.log(`#${d} late confirm -> rejected (${e.revert?.name})`); }
await (await c.connect(employer).markExpired(d)).wait();
console.log(`#${d} markExpired -> stored ${LABEL[Number((await c.getRecord(d)).status)]}`);
console.log(`ids for report ${h.slice(0, 12)}…: ${[...(await c.idsForReport(h))].join(",")}`);
