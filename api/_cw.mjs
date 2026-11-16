// CosmWasm side of the online demo (Vercel functions + local scripts share this file).
// The formal WageProof contract runs as CosmWasm on ME testnet Hub, where the contract itself reads the
// ME ID module (Stargate query /metaearth.did.Query/Did) and rejects an employer below the minimum level.
// No fs access here: Vercel bundles this file on its own. Files starting with "_" are not endpoints.
import { Secp256k1, keccak256, stringToPath } from "@cosmjs/crypto";
import { fromHex, toBase64, toBech32 } from "@cosmjs/encoding";
import { DirectSecp256k1HdWallet, makeAuthInfoBytes, makeSignDoc, makeSignBytes } from "@cosmjs/proto-signing";
import { CosmWasmClient, SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { GasPrice } from "@cosmjs/stargate";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

export const CW = Object.freeze({
  chainId: "mechain_400-1",
  rpc: "https://beta-hub-26657.explorer-testnet.me",
  rest: "https://beta-hub-1317.explorer-testnet.me",
  prefix: "me",
  denom: "umec",
  minGasPrice: "0.02umec",
  minFeeUmec: "10000",
  hdPath: "m/44'/118'/0'/0/0",
  contract: "me1kwhfggqzzjy3vnyvldymrrrmjcvxe8ajzlerhx3putherrht2xqsgfpjqc",
  codeId: 21,
  storeTx: "1C88EAA9F07382306932D791AB71515CBE3274BBF354B61D656BF12F75692896",
  instTx: "4231B5DC06DDF3C648B0ABCE811CDD41BBB2BAE44EA9A6CE6589F6A4169B7AB3",
  // on-chain proof that the contract itself refused an employer without ME ID (2026-11-16)
  rejectProofTx: "95F15D92C809E1DFD1D426488A263880FBE4293E407041B1B9B073D3B6A9939E",
});

export const txUrl = (hash) => `${CW.rest}/cosmos/tx/v1beta1/txs/${hash}`;

// Hub rejects fees under minFeeUmec: pay max(gas * minGasPrice, minFee).
export function feeForGas(gas) {
  const byPrice = BigInt(Math.ceil(gas * parseFloat(CW.minGasPrice)));
  const min = BigInt(CW.minFeeUmec);
  return { amount: [{ denom: CW.denom, amount: String(byPrice > min ? byPrice : min) }], gas: String(gas) };
}

// Contract errors look like "Generic error: NotEmployer: caller … is not employer …".
export function contractErrorName(e) {
  const m = String(e?.message ?? e).match(/Generic error: ([A-Za-z]+):/);
  return m ? m[1] : null;
}

// Signer from a Cosmos mnemonic (the demo worker).
export async function connectMnemonic(mnemonic) {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: CW.prefix, hdPaths: [stringToPath(CW.hdPath)] });
  const [{ address }] = await wallet.getAccounts();
  const client = await SigningCosmWasmClient.connectWithSigner(CW.rpc, wallet, { gasPrice: GasPrice.fromString(CW.minGasPrice) });
  return { client, address, registry: client.registry };
}

// Signer from an Ethereum-style key (Ethermint ethsecp256k1). The old demo employer was made as an EVM key,
// so its me1 address = last 20 bytes of keccak(pubkey); its Cosmos txs must carry an ethsecp256k1 pubkey and
// be signed over keccak256(signBytes). CosmJS has no signer for this, so the tx is built by hand.
const ETH_PUBKEY = "/ethermint.crypto.v1.ethsecp256k1.PubKey";
const pubkeyAny = (compressed) => ({ typeUrl: ETH_PUBKEY, value: Uint8Array.from([0x0a, compressed.length, ...compressed]) });

export async function connectEthKey(hexKey, registry) {
  if (!hexKey) throw new Error("missing key");
  const priv = fromHex(hexKey.replace(/^0x/, ""));
  const { pubkey: uncompressed } = await Secp256k1.makeKeypair(priv);
  const compressed = Secp256k1.compressPubkey(uncompressed);
  const address = toBech32(CW.prefix, keccak256(uncompressed.slice(1)).slice(-20));
  const q = await CosmWasmClient.connect(CW.rpc);

  async function buildTx(msgs, memo, gas, feeAmount) {
    // REST, not q.getAccount(): once the account has an ethsecp256k1 pubkey on chain, CosmJS cannot parse it.
    const r = await fetch(`${CW.rest}/cosmos/auth/v1beta1/accounts/${address}`, { signal: AbortSignal.timeout(15000) });
    const a = (await r.json()).account;
    if (!a) throw new Error(`account ${address} not found on chain`);
    const accountNumber = Number(a.account_number ?? a.base_account?.account_number);
    const sequence = Number(a.sequence ?? a.base_account?.sequence);
    const bodyBytes = registry.encodeTxBody({ messages: msgs, memo });
    const authInfoBytes = makeAuthInfoBytes([{ pubkey: pubkeyAny(compressed), sequence }], feeAmount, gas);
    const doc = makeSignDoc(bodyBytes, authInfoBytes, CW.chainId, accountNumber);
    const sig = await Secp256k1.createSignature(keccak256(makeSignBytes(doc)), priv);
    const sigBytes = Uint8Array.from([...sig.r(32), ...sig.s(32), sig.recovery]);
    return TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [sigBytes] })).finish();
  }

  const client = {
    getBalance: (a, d) => q.getBalance(a, d),
    queryContractSmart: (c, m) => q.queryContractSmart(c, m),
    getBlock: (h) => q.getBlock(h),
    async simulate(_from, msgs, memo = "") {
      const tx = await buildTx(msgs, memo, 2_000_000, [{ denom: CW.denom, amount: "40000" }]);
      const r = await fetch(`${CW.rest}/cosmos/tx/v1beta1/simulate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx_bytes: toBase64(tx) }), signal: AbortSignal.timeout(20000),
      });
      const j = await r.json();
      if (!r.ok || !j.gas_info) throw new Error(j.message ?? JSON.stringify(j));
      return Number(j.gas_info.gas_used);
    },
    async signAndBroadcast(from, msgs, fee, memo = "") {
      if (fee === "auto" || typeof fee === "number") fee = feeForGas(Math.ceil((await client.simulate(from, msgs, memo)) * 1.4));
      const tx = await buildTx(msgs, memo, Number(fee.gas), fee.amount);
      return q.broadcastTx(tx);
    },
  };
  return { client, address };
}
