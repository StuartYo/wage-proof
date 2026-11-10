// Deploy WageProof.
//   local:   npx hardhat node   (other terminal)  then  npx hardhat run scripts/deploy.cjs --network localhost
//   testnet: npx hardhat run scripts/deploy.cjs --network metestnet
// On testnet it first does read-only checks (chain id, balance). With a zero balance it stops
// and says so: testnet MEC only comes from the official faucet, which the wallet owner claims himself.
const { ethers, network } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");
const net = require("../config/network.json");

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) throw new Error("no signer: put TESTNET_MNEMONIC in .env (run `npm run wallet`)");
  const [deployer] = signers;
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`network=${network.name} chainId=${chainId} deployer=${deployer.address}`);

  if (network.name === "metestnet" && Number(chainId) !== net.evm.chainId) {
    throw new Error(`chain id ${chainId} != expected ${net.evm.chainId}; refusing to deploy`);
  }
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`balance=${ethers.formatEther(balance)} MEC (EVM shows 18 decimals; 1 umec = 1e10 wei)`);
  if (balance === 0n) {
    console.log("STOP: balance is 0. Waiting for testnet MEC from the official faucet (owner claims it). Nothing sent.");
    process.exitCode = 3;
    return;
  }

  const factory = await ethers.getContractFactory("WageProof");
  const contract = await factory.deploy();
  const tx = contract.deploymentTransaction();
  console.log(`deploy tx: ${tx.hash}`);
  await contract.waitForDeployment();
  const receipt = await tx.wait();
  const address = await contract.getAddress();
  console.log(`WageProof deployed at ${address} (block ${receipt.blockNumber}, gasUsed ${receipt.gasUsed})`);

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${network.name}.json`), JSON.stringify({
    network: network.name, chainId: Number(chainId), address, deployTx: tx.hash,
    block: receipt.blockNumber, deployer: deployer.address, deployedAt: new Date().toISOString(),
  }, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
