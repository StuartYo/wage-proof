// Cosmos-tx signing for Ethereum-style keys (Ethermint ethsecp256k1).
// The old demo accounts (DEMO_EMPLOYER_KEY / DEMO_WORKER_KEY in .env.demo) were made as EVM keys, so their
// me1 address = last 20 bytes of keccak(pubkey). To call a CosmWasm contract from them, the tx must carry an
// /ethermint.crypto.v1.ethsecp256k1.PubKey and be signed over keccak256(signBytes). CosmJS has no built-in
// signer for this, so this file builds and signs the tx by hand. Keys are read from .env.demo, never printed.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Secp256k1, keccak256 } from "@cosmjs/crypto";
import { fromHex, toBase64, toBech32 } from "@cosmjs/encoding";
import { makeAuthInfoBytes, makeSignDoc, makeSignBytes } from "@cosmjs/proto-signing";
import { CosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { config, ROOT } from "./lib.mjs";

// Hub rejects fees under minFeeUmec: pay max(gas * minGasPrice, minFee) (same rule as cw-lib feeFor).
function feeForGas(gas) {
  const byPrice = BigInt(Math.ceil(gas * parseFloat(config.minGasPrice)));
  const min = BigInt(config.minFeeUmec);
  return { amount: [{ denom: config.denom, amount: String(byPrice > min ? byPrice : min) }], gas: String(gas) };
}

export function readDemoKey(name) {
  const p = join(ROOT, ".env.demo");
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf8").match(new RegExp(`^${name}="?(0x)?([0-9a-fA-F]{64})"?\\s*$`, "m"));
  return m ? m[2] : null;
}

const ETH_PUBKEY = "/ethermint.crypto.v1.ethsecp256k1.PubKey";
const pubkeyAny = (compressed) => ({ typeUrl: ETH_PUBKEY, value: Uint8Array.from([0x0a, compressed.length, ...compressed]) });

// Returns an object shaped like cw-lib connect(): { client, address } where client has the methods
// cw-e2e.mjs uses (simulate, signAndBroadcast, getBalance, queryContractSmart, getBlock).
export async function connectEthKey(hexKey, registry) {
  if (!hexKey) throw new Error("missing key");
  const priv = fromHex(hexKey);
  const { pubkey: uncompressed } = await Secp256k1.makeKeypair(priv);
  const compressed = Secp256k1.compressPubkey(uncompressed);
  const address = toBech32(config.bech32Prefix, keccak256(uncompressed.slice(1)).slice(-20));
  const q = await CosmWasmClient.connect(config.hub.rpc);
  const chainId = await q.getChainId();
  if (chainId !== config.cosmosChainId) throw new Error(`chain id ${chainId} != ${config.cosmosChainId}`);

  async function buildTx(msgs, memo, gas, feeAmount) {
    // REST, not q.getAccount(): once the account has an ethsecp256k1 pubkey on chain, CosmJS cannot parse it.
    const r = await fetch(`${config.hub.rest}/cosmos/auth/v1beta1/accounts/${address}`);
    const a = (await r.json()).account;
    if (!a) throw new Error(`account ${address} not found on chain`);
    const acct = { accountNumber: Number(a.account_number ?? a.base_account?.account_number),
      sequence: Number(a.sequence ?? a.base_account?.sequence) };
    const bodyBytes = registry.encodeTxBody({ messages: msgs, memo });
    const authInfoBytes = makeAuthInfoBytes([{ pubkey: pubkeyAny(compressed), sequence: acct.sequence }], feeAmount, gas);
    const doc = makeSignDoc(bodyBytes, authInfoBytes, chainId, acct.accountNumber);
    const sig = await Secp256k1.createSignature(keccak256(makeSignBytes(doc)), priv);
    const sigBytes = Uint8Array.from([...sig.r(32), ...sig.s(32), sig.recovery]);
    return TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [sigBytes] })).finish();
  }

  const client = {
    getBalance: (a, d) => q.getBalance(a, d),
    queryContractSmart: (c, m) => q.queryContractSmart(c, m),
    getBlock: (h) => q.getBlock(h),
    getAccount: (a) => q.getAccount(a),
    async simulate(_from, msgs, memo = "") {
      const tx = await buildTx(msgs, memo, 2_000_000, [{ denom: config.denom, amount: "40000" }]);
      const r = await fetch(`${config.hub.rest}/cosmos/tx/v1beta1/simulate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx_bytes: toBase64(tx) }),
      });
      const j = await r.json();
      if (!r.ok || !j.gas_info) throw new Error(j.message ?? JSON.stringify(j));
      return Number(j.gas_info.gas_used);
    },
    async signAndBroadcast(_from, msgs, fee, memo = "") {
      if (fee === "auto" || typeof fee === "number") fee = feeForGas(Math.ceil((await client.simulate(_from, msgs, memo)) * 1.4));
      const tx = await buildTx(msgs, memo, Number(fee.gas), fee.amount);
      return q.broadcastTx(tx);
    },
  };
  return { client, address };
}
