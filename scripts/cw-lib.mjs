// Shared CosmWasm helpers (CosmJS). Reads keys from .env / .env.demo, never prints them.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { GasPrice } from "@cosmjs/stargate";
import { stringToPath } from "@cosmjs/crypto";
import { toUtf8 } from "@cosmjs/encoding";
import { config, readMnemonic, ROOT } from "./lib.mjs";

export const DEPLOY_FILE = join(ROOT, "deployments", "cw-testnet.json");
export const loadDeploy = () => (existsSync(DEPLOY_FILE) ? JSON.parse(readFileSync(DEPLOY_FILE, "utf8")) : {});
export const saveDeploy = (d) => writeFileSync(DEPLOY_FILE, JSON.stringify(d, null, 2) + "\n");

export function readDemoMnemonic(name) {
  const p = join(ROOT, ".env.demo");
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf8").match(new RegExp(`^${name}="?([a-z ]+)"?\s*$`, "m"));
  return m ? m[1].trim() : null;
}

export async function connect(mnemonic = readMnemonic()) {
  if (!mnemonic) throw new Error("missing mnemonic");
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: config.bech32Prefix, hdPaths: [stringToPath(config.hdPaths.main)],
  });
  const [{ address }] = await wallet.getAccounts();
  const client = await SigningCosmWasmClient.connectWithSigner(config.hub.rpc, wallet, {
    gasPrice: GasPrice.fromString(config.minGasPrice),
  });
  const chainId = await client.getChainId();
  if (chainId !== config.cosmosChainId) throw new Error(`chain id ${chainId} != ${config.cosmosChainId}`);
  return { client, address };
}

// Hub rejects fees under 10000 umec, so: simulate gas, pay max(gas * minGasPrice, minFee).
export async function feeFor(client, from, msgs, memo = "") {
  const gas = Math.ceil((await client.simulate(from, msgs, memo)) * 1.4);
  const byPrice = BigInt(Math.ceil(gas * parseFloat(config.minGasPrice)));
  const min = BigInt(config.minFeeUmec);
  return { amount: [{ denom: config.denom, amount: String(byPrice > min ? byPrice : min) }], gas: String(gas) };
}

export async function broadcast(client, from, msgs, memo = "") {
  const fee = await feeFor(client, from, msgs, memo);
  const res = await client.signAndBroadcast(from, msgs, fee, memo);
  if (res.code !== 0) throw new Error(`tx failed code=${res.code} log=${res.rawLog} hash=${res.transactionHash}`);
  return { res, fee };
}

export const attr = (res, type, key) =>
  res.events.find((e) => e.type === type)?.attributes.find((a) => a.key === key)?.value;

export const storeMsg = (sender, wasm) => ({ typeUrl: "/cosmwasm.wasm.v1.MsgStoreCode",
  value: { sender, wasmByteCode: gzipSync(wasm, { level: 9 }) } });
export const instMsg = (sender, codeId, msg, label) => ({ typeUrl: "/cosmwasm.wasm.v1.MsgInstantiateContract",
  value: { sender, codeId: BigInt(codeId), label, msg: toUtf8(JSON.stringify(msg)), funds: [], admin: "" } });
export const execMsg = (sender, contract, msg, funds = []) => ({ typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
  value: { sender, contract, msg: toUtf8(JSON.stringify(msg)), funds } });

export async function upload(client, from, file, label, initMsg = {}) {
  const wasm = readFileSync(file);
  const s = await broadcast(client, from, [storeMsg(from, wasm)]);
  const codeId = Number(attr(s.res, "store_code", "code_id"));
  const i = await broadcast(client, from, [instMsg(from, codeId, initMsg, label)]);
  const contract = attr(i.res, "instantiate", "_contract_address");
  return { codeId, contract, storeTx: s.res.transactionHash, storeFee: s.fee, instTx: i.res.transactionHash, instFee: i.fee };
}

export function logger(file) {
  const lines = [];
  const log = (...a) => { const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "); lines.push(s); console.log(s); };
  log.save = () => writeFileSync(file, lines.join("\n") + "\n");
  return log;
}
