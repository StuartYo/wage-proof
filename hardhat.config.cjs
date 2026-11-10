require("@nomicfoundation/hardhat-ethers");
require("dotenv").config({ quiet: true });
const { HDNodeWallet } = require("ethers");
const net = require("./config/network.json");

// Testnet signer comes from the git-ignored .env mnemonic (testnet-only wallet).
// Account 0 = worker/deployer, account 1 = demo employer (same mnemonic, next index).
function testnetAccounts() {
  const m = process.env.TESTNET_MNEMONIC;
  if (!m) return [];
  return [0, 1].map(i => HDNodeWallet.fromPhrase(m, undefined, `m/44'/60'/0'/0/${i}`).privateKey);
}

module.exports = {
  solidity: {
    version: "0.8.24",
    // "paris" avoids PUSH0/MCOPY opcodes in case the chain's EVM does not run them,
    // even though its params list shanghai/cancun at block 0 (not verified on chain yet).
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  paths: { tests: "./test" },
  networks: {
    metestnet: {
      url: process.env.ME_EVM_RPC || net.evm.rpc,
      chainId: net.evm.chainId,
      accounts: testnetAccounts(),
    },
  },
};
