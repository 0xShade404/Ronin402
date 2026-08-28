import { ethers } from "hardhat";

/// Deploys RoninVaultFactory to whatever network Hardhat is pointed at
/// (`--network <name>`, configured in hardhat.config.ts via env vars).
/// This script does NOT create a vault or move funds — it only deploys the
/// factory contract. Creating a vault (factory.createVault()) and funding it
/// are separate, deliberate actions the vault owner takes afterward.
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying RoninVaultFactory with account: ${deployer.address}`);

  const Factory = await ethers.getContractFactory("RoninVaultFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  console.log(`RoninVaultFactory deployed to: ${await factory.getAddress()}`);
  console.log(
    "Next: call factory.createVault() from the account that should own the vault, " +
      "then fund it via depositERC20()/a plain ETH transfer, then owner.createSession(...) " +
      "to authorize an agent."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
