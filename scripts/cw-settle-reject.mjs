// Day 6: put one "employer without ME ID" refusal on chain for the v0.3 settlement contract, so the online
// demo can link to a real failed transaction (the server itself only simulates and never sends a refused call).
// Broadcast with a fixed fee, no simulate shortcut, so the refused tx lands in a block with a hash.
// Usage: node scripts/cw-settle-reject.mjs   -> appends to docs/evidence/cw-d-e2e.txt
import { join } from "node:path";
import { appendFileSync } from "node:fs";
import { config, ROOT } from "./lib.mjs";
import { hashReport } from "./hash-report.mjs";
import { connect, execMsg, loadDeploy, readDemoMnemonic } from "./cw-lib.mjs";

const NO_MEID = "me1mhyngg3dww60msw6dej4mkzheewjck86450e7g";
const C = loadDeploy().wageProofSettle.contract;
const worker = await connect(readDemoMnemonic("DEMO_CW_WORKER_MNEMONIC"));
const REPORT = hashReport(join(ROOT, "demo", "synthetic-report.json")).slice(2);
const before = await worker.client.queryContractSmart(C, { count: {} });
const msg = { submit: { report_hash: REPORT, employer: NO_MEID, deadline_seconds: 60, claim: "523000" } };
const res = await worker.client.signAndBroadcast(worker.address, [execMsg(worker.address, C, msg)],
  { amount: [{ denom: config.denom, amount: config.minFeeUmec }], gas: "500000" }, "");
const after = await worker.client.queryContractSmart(C, { count: {} });
const ok = res.code !== 0 && String(res.rawLog).includes("EmployerNotVerified") && after === before;
const lines = [
  "", `## (6) ${new Date().toISOString()} employer without ME ID -> contract refuses (v0.3 contract ${C})`,
  `TX (6) worker submit claim=523000 employer=${NO_MEID}: code=${res.code} hash=${res.transactionHash} height=${res.height}`,
  `  on-chain raw_log: ${res.rawLog}`, `  REST: ${config.hub.rest}/cosmos/tx/v1beta1/txs/${res.transactionHash}`,
  `  ${ok ? "PASS" : "UNEXPECTED"}: rejected with EmployerNotVerified, count ${before} -> ${after}`,
];
appendFileSync(join(ROOT, "docs", "evidence", "cw-d-e2e.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
process.exit(ok ? 0 : 1);
