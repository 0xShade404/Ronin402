import { ethers } from "hardhat";
import fs from "node:fs";

/// Local-only helper: deploys a factory + a funded vault + mock tokens/venue
/// against whatever network Hardhat is pointed at, and writes the resulting
/// addresses to a JSON file so an external script (e.g. a Playwright test)
/// can pick them up. Not part of the production deploy path — see deploy.ts.
async function main() {
  const [deployer, agent] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("Mock USD Coin", "mUSDC", 6);
  const rwa = await MockERC20.deploy("Mock T-Bill Token", "mTBILL", 18);

  const Factory = await ethers.getContractFactory("RoninVaultFactory");
  const factory = await Factory.deploy();
  const tx = await factory.connect(deployer).createVault();
  const receipt = await tx.wait();
  const event = receipt!.logs
    .map((l) => {
      try {
        return factory.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "VaultCreated");
  const vaultAddress = event!.args.vault as string;
  const vault = await ethers.getContractAt("RoninVault", vaultAddress);

  const Venue = await ethers.getContractFactory("MockRWAVenue");
  const venue = await Venue.deploy(deployer.address);

  await rwa.mint(await venue.getAddress(), ethers.parseUnits("1000000", 18));
  await venue
    .connect(deployer)
    .setRate(await usdc.getAddress(), await rwa.getAddress(), ethers.parseUnits("1", 18), ethers.parseUnits("1", 6));

  await usdc.mint(deployer.address, ethers.parseUnits("100000", 6));
  await usdc.connect(deployer).approve(vaultAddress, ethers.MaxUint256);
  await vault.connect(deployer).depositERC20(await usdc.getAddress(), ethers.parseUnits("10000", 6));

  const expiry = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  await vault
    .connect(deployer)
    .createSession(
      agent.address,
      await usdc.getAddress(),
      ethers.parseUnits("100", 6),
      ethers.parseUnits("500", 6),
      24 * 3600,
      expiry,
      [await rwa.getAddress()],
      [await venue.getAddress()]
    );

  const out = {
    deployer: deployer.address,
    agent: agent.address,
    factory: await factory.getAddress(),
    vault: vaultAddress,
    usdc: await usdc.getAddress(),
    rwa: await rwa.getAddress(),
    venue: await venue.getAddress(),
  };

  const outPath = process.env.DEV_DEPLOY_OUT ?? "./dev-deploy.json";
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
