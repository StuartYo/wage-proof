// Fallback path: write a report fingerprint on ME Hub as the memo of a tiny bank transfer (CosmJS).
// The official JS SDK is unpublished from npm, so this uses CosmJS directly (standard Cosmos tx;
// testnet accounts use /cosmos.crypto.secp256k1.PubKey, checked on chain 2026-11-10).
//
// Usage: node scripts/memo-tx.mjs [reportFile] [--to me1...] [--amount 1] [--yes]
//   default recipient = this wallet's own EVM account (its me1 form), so the transfer also
//   funds the EVM side. Without --yes it only prints what it would send.
// With a zero balance it stops ("waiting for faucet") and sends nothing.
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningStargateClient, GasPrice } from "@cosmjs/stargate";
import { stringToPath } from "@cosmjs/crypto";
import { HDNodeWallet } from "ethers";
import { config, readMnemonic, evmToBech32 } from "./lib.mjs";
import { hashReport } from "./hash-report.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const VALUE_FLAGS = ["--to", "--amount"];
const reportFile = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1])) || "demo/synthetic-report.json";
const amount = opt("--amount", "1");          // umec
const send = args.includes("--yes");

const mnemonic = readMnemonic();
if (!mnemonic) { console.error("no TESTNET_MNEMONIC in .env; run `npm run wallet`"); process.exit(2); }

const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
  prefix: config.bech32Prefix, hdPaths: [stringToPath(config.hdPaths.main)],
});
const [{ address: from }] = await wallet.getAccounts();
const to = opt("--to", evmToBech32(HDNodeWallet.fromPhrase(mnemonic, undefined, config.hdPaths.evm).address));

const hash = hashReport(reportFile);
const memo = `wage-proof:v1:sha256:${hash.slice(2)}`;
if (memo.length > 256) throw new Error("memo over 256 chars");

const client = await SigningStargateClient.connectWithSigner(config.hub.rpc, wallet, {
  gasPrice: GasPrice.fromString(config.minGasPrice),
});
const chainId = await client.getChainId();
if (chainId !== config.cosmosChainId) throw new Error(`chain id ${chainId} != ${config.cosmosChainId}`);
const bal = await client.getBalance(from, config.denom);
console.log(JSON.stringify({ chainId, from, to, amount: `${amount}${config.denom}`, memo, balance: bal }, null, 2));

if (BigInt(bal.amount) === 0n) {
  console.log("STOP: balance is 0. Waiting for testnet MEC from the official faucet (owner claims it). Nothing sent.");
  process.exit(3);
}
if (!send) { console.log("dry run: add --yes to broadcast"); process.exit(0); }

const res = await client.sendTokens(from, to, [{ denom: config.denom, amount }], "auto", memo);
console.log(JSON.stringify({ code: res.code, txhash: res.transactionHash, height: res.height,
  rest: `${config.hub.rest}/cosmos/tx/v1beta1/txs/${res.transactionHash}` }, null, 2));
