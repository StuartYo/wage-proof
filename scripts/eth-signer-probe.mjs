// Probe: can the old EVM demo employer sign a Cosmos tx? Sends 1 umec to itself (fee ~10000 umec).
// Usage: node scripts/eth-signer-probe.mjs
import { Registry } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import { config } from "./lib.mjs";
import { connectEthKey, readDemoKey } from "./eth-signer.mjs";

const registry = new Registry(defaultRegistryTypes);
const emp = await connectEthKey(readDemoKey("DEMO_EMPLOYER_KEY"), registry);
console.log("address", emp.address);
const msg = { typeUrl: "/cosmos.bank.v1beta1.MsgSend",
  value: { fromAddress: emp.address, toAddress: emp.address, amount: [{ denom: config.denom, amount: "1" }] } };
const gas = await emp.client.simulate(emp.address, [msg], "eth-signer probe");
console.log("simulate gas", gas);
const res = await emp.client.signAndBroadcast(emp.address, [msg], "auto", "eth-signer probe");
console.log("code", res.code, "hash", res.transactionHash, "height", res.height, "log", res.rawLog ?? "");
