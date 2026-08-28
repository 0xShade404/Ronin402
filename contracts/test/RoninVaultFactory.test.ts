import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("RoninVaultFactory", () => {
  async function deployFixture() {
    const [alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("RoninVaultFactory");
    const factory = await Factory.deploy();
    return { factory, alice, bob };
  }

  it("deploys a distinct vault per call, owned by the caller", async () => {
    const { factory, alice, bob } = await loadFixture(deployFixture);

    const tx1 = await factory.connect(alice).createVault();
    const receipt1 = await tx1.wait();
    const event1 = receipt1!.logs
      .map((l) => factory.interface.parseLog(l))
      .find((e) => e?.name === "VaultCreated");
    const vault1Addr = event1!.args.vault as string;

    const tx2 = await factory.connect(bob).createVault();
    const receipt2 = await tx2.wait();
    const event2 = receipt2!.logs
      .map((l) => factory.interface.parseLog(l))
      .find((e) => e?.name === "VaultCreated");
    const vault2Addr = event2!.args.vault as string;

    expect(vault1Addr).to.not.equal(vault2Addr);

    const vault1 = await ethers.getContractAt("RoninVault", vault1Addr);
    const vault2 = await ethers.getContractAt("RoninVault", vault2Addr);
    expect(await vault1.owner()).to.equal(alice.address);
    expect(await vault2.owner()).to.equal(bob.address);

    expect(await factory.vaultCountOf(alice.address)).to.equal(1);
    expect(await factory.vaultsOf(alice.address, 0)).to.equal(vault1Addr);
  });

  it("lets one owner deploy multiple independent vaults", async () => {
    const { factory, alice } = await loadFixture(deployFixture);
    await factory.connect(alice).createVault();
    await factory.connect(alice).createVault();
    expect(await factory.vaultCountOf(alice.address)).to.equal(2);

    const addr0 = await factory.vaultsOf(alice.address, 0);
    const addr1 = await factory.vaultsOf(alice.address, 1);
    expect(addr0).to.not.equal(addr1);
  });
});
