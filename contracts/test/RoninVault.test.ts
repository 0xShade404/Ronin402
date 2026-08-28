import { expect } from "chai";
import { ethers } from "hardhat";
import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { AddressLike, BigNumberish } from "ethers";

const DAY = 24 * 60 * 60;

async function deployFixture() {
  const [owner, agent, attacker, other] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("Mock USD Coin", "mUSDC", 6);
  const rwa = await MockERC20.deploy("Mock T-Bill Token", "mTBILL", 18);

  const Factory = await ethers.getContractFactory("RoninVaultFactory");
  const factory = await Factory.deploy();
  const tx = await factory.connect(owner).createVault();
  const receipt = await tx.wait();
  const parsed = receipt!.logs
    .map((l) => {
      try {
        return factory.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "VaultCreated");
  const vaultAddress = parsed!.args.vault as string;
  const vault = await ethers.getContractAt("RoninVault", vaultAddress);

  const Venue = await ethers.getContractFactory("MockRWAVenue");
  const venue = await Venue.deploy(owner.address);

  const usdcAddr = await usdc.getAddress();
  const rwaAddr = await rwa.getAddress();
  const venueAddr = await venue.getAddress();
  const vaultAddr = await vault.getAddress();

  // Seed venue with RWA liquidity and set a 1:1 (decimal-adjusted) rate.
  await rwa.mint(venueAddr, ethers.parseUnits("1000000", 18));
  await venue
    .connect(owner)
    .setRate(usdcAddr, rwaAddr, ethers.parseUnits("1", 18), ethers.parseUnits("1", 6));

  // Fund the owner and deposit collateral into the vault.
  await usdc.mint(owner.address, ethers.parseUnits("100000", 6));
  await usdc.connect(owner).approve(vaultAddr, ethers.MaxUint256);
  await vault.connect(owner).depositERC20(usdcAddr, ethers.parseUnits("10000", 6));

  return { owner, agent, attacker, other, usdc, rwa, factory, vault, venue, usdcAddr, rwaAddr, venueAddr, vaultAddr };
}

async function createDefaultSession(
  vault: any,
  owner: any,
  agent: AddressLike,
  spendToken: AddressLike,
  outputTokens: AddressLike[],
  venues: AddressLike[],
  overrides: Partial<{
    maxPerTx: BigNumberish;
    maxPerPeriod: BigNumberish;
    periodDuration: number;
    expiry: number;
  }> = {}
) {
  const maxPerTx = overrides.maxPerTx ?? ethers.parseUnits("100", 6);
  const maxPerPeriod = overrides.maxPerPeriod ?? ethers.parseUnits("500", 6);
  const periodDuration = overrides.periodDuration ?? DAY;
  const expiry = overrides.expiry ?? ((await time.latest()) + 30 * DAY);

  const tx = await vault
    .connect(owner)
    .createSession(agent, spendToken, maxPerTx, maxPerPeriod, periodDuration, expiry, outputTokens, venues);
  const receipt = await tx.wait();
  const event = receipt.logs
    .map((l: any) => {
      try {
        return vault.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e: any) => e?.name === "SessionCreated");
  return event!.args.sessionId as bigint;
}

describe("RoninVault", () => {
  describe("session creation (owner only)", () => {
    it("rejects session creation from non-owner", async () => {
      const { vault, agent, attacker, usdcAddr, rwaAddr, venueAddr } = await loadFixture(deployFixture);
      await expect(
        vault
          .connect(attacker)
          .createSession(agent.address, usdcAddr, 1, 1, DAY, (await time.latest()) + DAY, [rwaAddr], [venueAddr])
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("rejects a zero agent address", async () => {
      const { vault, owner, usdcAddr, rwaAddr, venueAddr } = await loadFixture(deployFixture);
      await expect(
        vault
          .connect(owner)
          .createSession(ethers.ZeroAddress, usdcAddr, 1, 1, DAY, (await time.latest()) + DAY, [rwaAddr], [venueAddr])
      ).to.be.revertedWith("RoninVault: zero agent");
    });

    it("rejects maxPerTx greater than maxPerPeriod", async () => {
      const { vault, owner, agent, usdcAddr, rwaAddr, venueAddr } = await loadFixture(deployFixture);
      await expect(
        vault
          .connect(owner)
          .createSession(agent.address, usdcAddr, 100, 50, DAY, (await time.latest()) + DAY, [rwaAddr], [venueAddr])
      ).to.be.revertedWith("RoninVault: invalid caps");
    });

    it("rejects an expiry in the past", async () => {
      const { vault, owner, agent, usdcAddr, rwaAddr, venueAddr } = await loadFixture(deployFixture);
      await expect(
        vault.connect(owner).createSession(agent.address, usdcAddr, 1, 1, DAY, 1, [rwaAddr], [venueAddr])
      ).to.be.revertedWith("RoninVault: expiry in past");
    });

    it("rejects an empty output-token or venue list", async () => {
      const { vault, owner, agent, usdcAddr, rwaAddr, venueAddr } = await loadFixture(deployFixture);
      const expiry = (await time.latest()) + DAY;
      await expect(
        vault.connect(owner).createSession(agent.address, usdcAddr, 1, 1, DAY, expiry, [], [venueAddr])
      ).to.be.revertedWith("RoninVault: no output tokens");
      await expect(
        vault.connect(owner).createSession(agent.address, usdcAddr, 1, 1, DAY, expiry, [rwaAddr], [])
      ).to.be.revertedWith("RoninVault: no venues");
    });

    it("rejects an output token equal to the spend token", async () => {
      const { vault, owner, agent, usdcAddr, venueAddr } = await loadFixture(deployFixture);
      const expiry = (await time.latest()) + DAY;
      await expect(
        vault.connect(owner).createSession(agent.address, usdcAddr, 1, 1, DAY, expiry, [usdcAddr], [venueAddr])
      ).to.be.revertedWith("RoninVault: output equals spend token");
    });

    it("exposes session policy via getSession", async () => {
      const { vault, owner, agent, usdcAddr, rwaAddr, venueAddr } = await loadFixture(deployFixture);
      const sessionId = await createDefaultSession(vault, owner, agent.address, usdcAddr, [rwaAddr], [venueAddr]);
      const session = await vault.getSession(sessionId);
      expect(session.agent).to.equal(agent.address);
      expect(session.spendToken).to.equal(usdcAddr);
      expect(session.revoked).to.equal(false);
    });
  });

  describe("executeTrade", () => {
    async function sessionFixture() {
      const base = await deployFixture();
      const sessionId = await createDefaultSession(
        base.vault,
        base.owner,
        base.agent.address,
        base.usdcAddr,
        [base.rwaAddr],
        [base.venueAddr]
      );
      return { ...base, sessionId };
    }

    it("settles a trade within policy and emits a receipt", async () => {
      const { vault, agent, usdc, rwa, vaultAddr, usdcAddr, rwaAddr, venueAddr, sessionId } = await loadFixture(
        sessionFixture
      );
      const spend = ethers.parseUnits("50", 6);
      const minOut = ethers.parseUnits("50", 18);
      const deadline = (await time.latest()) + 3600;

      const usdcBefore = await usdc.balanceOf(vaultAddr);
      const rwaBefore = await rwa.balanceOf(vaultAddr);

      await expect(vault.connect(agent).executeTrade(sessionId, rwaAddr, spend, minOut, venueAddr, deadline))
        .to.emit(vault, "TradeExecuted")
        .withArgs(sessionId, agent.address, usdcAddr, spend, rwaAddr, minOut, venueAddr);

      expect(await usdc.balanceOf(vaultAddr)).to.equal(usdcBefore - spend);
      expect(await rwa.balanceOf(vaultAddr)).to.be.gte(rwaBefore + minOut);
    });

    it("rejects execution from anyone other than the session's agent", async () => {
      const { vault, attacker, owner, rwaAddr, venueAddr, sessionId } = await loadFixture(sessionFixture);
      const deadline = (await time.latest()) + 3600;
      await expect(
        vault.connect(attacker).executeTrade(sessionId, rwaAddr, 1, 1, venueAddr, deadline)
      ).to.be.revertedWith("RoninVault: not session agent");
      await expect(
        vault.connect(owner).executeTrade(sessionId, rwaAddr, 1, 1, venueAddr, deadline)
      ).to.be.revertedWith("RoninVault: not session agent");
    });

    it("enforces the per-transaction cap", async () => {
      const { vault, agent, rwaAddr, venueAddr, sessionId } = await loadFixture(sessionFixture);
      const deadline = (await time.latest()) + 3600;
      const tooMuch = ethers.parseUnits("101", 6); // maxPerTx is 100
      await expect(
        vault.connect(agent).executeTrade(sessionId, rwaAddr, tooMuch, 1, venueAddr, deadline)
      ).to.be.revertedWith("RoninVault: exceeds per-tx cap");
    });

    it("enforces the rolling per-period cap and resets after the window", async () => {
      const { vault, agent, rwaAddr, venueAddr, sessionId } = await loadFixture(sessionFixture);
      const spend = ethers.parseUnits("100", 6); // maxPerTx = 100, maxPerPeriod = 500
      const minOut = ethers.parseUnits("100", 18);
      const deadline = (await time.latest()) + 100 * DAY;

      for (let i = 0; i < 5; i++) {
        await vault.connect(agent).executeTrade(sessionId, rwaAddr, spend, minOut, venueAddr, deadline);
      }
      // 5 * 100 = 500 == maxPerPeriod; a 6th trade must fail within the same window.
      await expect(
        vault.connect(agent).executeTrade(sessionId, rwaAddr, spend, minOut, venueAddr, deadline)
      ).to.be.revertedWith("RoninVault: exceeds period cap");

      // After the period elapses, the budget resets.
      await time.increase(DAY + 1);
      await expect(vault.connect(agent).executeTrade(sessionId, rwaAddr, spend, minOut, venueAddr, deadline)).to.not
        .be.reverted;
    });

    it("reports availablePeriodBudget correctly across spend and reset", async () => {
      const { vault, agent, rwaAddr, venueAddr, sessionId } = await loadFixture(sessionFixture);
      const spend = ethers.parseUnits("100", 6);
      const minOut = ethers.parseUnits("100", 18);
      const deadline = (await time.latest()) + 100 * DAY;

      expect(await vault.availablePeriodBudget(sessionId)).to.equal(ethers.parseUnits("500", 6));
      await vault.connect(agent).executeTrade(sessionId, rwaAddr, spend, minOut, venueAddr, deadline);
      expect(await vault.availablePeriodBudget(sessionId)).to.equal(ethers.parseUnits("400", 6));

      await time.increase(DAY + 1);
      expect(await vault.availablePeriodBudget(sessionId)).to.equal(ethers.parseUnits("500", 6));
    });

    it("rejects trades to a venue outside the session's allowlist", async () => {
      const { vault, owner, agent, rwaAddr, sessionId } = await loadFixture(sessionFixture);
      const Venue = await ethers.getContractFactory("MockRWAVenue");
      const rogueVenue = await Venue.deploy(owner.address);
      const deadline = (await time.latest()) + 3600;
      await expect(
        vault.connect(agent).executeTrade(sessionId, rwaAddr, 1, 1, await rogueVenue.getAddress(), deadline)
      ).to.be.revertedWith("RoninVault: venue not allowed");
    });

    it("rejects trades into an output token outside the session's allowlist", async () => {
      const { vault, agent, venueAddr, sessionId } = await loadFixture(sessionFixture);
      const Other = await ethers.getContractFactory("MockERC20");
      const otherToken = await Other.deploy("Other", "OTH", 18);
      const deadline = (await time.latest()) + 3600;
      await expect(
        vault.connect(agent).executeTrade(sessionId, await otherToken.getAddress(), 1, 1, venueAddr, deadline)
      ).to.be.revertedWith("RoninVault: output token not allowed");
    });

    it("rejects a trade deadline that has passed even if the session hasn't expired", async () => {
      const { vault, agent, rwaAddr, venueAddr, sessionId } = await loadFixture(sessionFixture);
      const pastDeadline = (await time.latest()) - 1;
      await expect(
        vault.connect(agent).executeTrade(sessionId, rwaAddr, 1, 1, venueAddr, pastDeadline)
      ).to.be.revertedWith("RoninVault: trade expired");
    });

    it("rejects trading on an expired session", async () => {
      const { vault, owner, agent, usdcAddr, rwaAddr, venueAddr } = await loadFixture(deployFixture);
      const expiry = (await time.latest()) + DAY;
      const sessionId = await createDefaultSession(vault, owner, agent.address, usdcAddr, [rwaAddr], [venueAddr], {
        expiry,
      });
      await time.increaseTo(expiry + 1);
      await expect(
        vault.connect(agent).executeTrade(sessionId, rwaAddr, 1, 1, venueAddr, expiry + 1000)
      ).to.be.revertedWith("RoninVault: session expired");
    });

    it("rejects trading on a revoked session", async () => {
      const { vault, owner, agent, rwaAddr, venueAddr, sessionId } = await loadFixture(sessionFixture);
      await vault.connect(owner).revokeSession(sessionId);
      const deadline = (await time.latest()) + 3600;
      await expect(
        vault.connect(agent).executeTrade(sessionId, rwaAddr, 1, 1, venueAddr, deadline)
      ).to.be.revertedWith("RoninVault: session revoked");
    });

    it("rejects double-revocation", async () => {
      const { vault, owner, sessionId } = await loadFixture(sessionFixture);
      await vault.connect(owner).revokeSession(sessionId);
      await expect(vault.connect(owner).revokeSession(sessionId)).to.be.revertedWith("RoninVault: already revoked");
    });

    it("rejects a zero minAmountOut", async () => {
      const { vault, agent, rwaAddr, venueAddr, sessionId } = await loadFixture(sessionFixture);
      const deadline = (await time.latest()) + 3600;
      await expect(
        vault.connect(agent).executeTrade(sessionId, rwaAddr, ethers.parseUnits("1", 6), 0, venueAddr, deadline)
      ).to.be.revertedWith("RoninVault: zero min out");
    });

    it("halts all trading while paused, and resumes after unpause", async () => {
      const { vault, owner, agent, rwaAddr, venueAddr, sessionId } = await loadFixture(sessionFixture);
      const deadline = (await time.latest()) + 3600;
      await vault.connect(owner).pause();
      await expect(
        vault.connect(agent).executeTrade(sessionId, rwaAddr, ethers.parseUnits("1", 6), 1, venueAddr, deadline)
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");

      await vault.connect(owner).unpause();
      await expect(
        vault
          .connect(agent)
          .executeTrade(sessionId, rwaAddr, ethers.parseUnits("1", 6), ethers.parseUnits("1", 18), venueAddr, deadline)
      ).to.not.be.reverted;
    });

    it("catches under-delivery even when the venue lies about amountOut", async () => {
      const { vault, owner, agent, rwa, usdcAddr, rwaAddr } = await loadFixture(sessionFixture);
      const Faulty = await ethers.getContractFactory("MockFaultyVenue");
      const faulty = await Faulty.deploy();
      const faultyAddr = await faulty.getAddress();
      await rwa.mint(faultyAddr, ethers.parseUnits("1000", 18));

      // Allow the faulty venue on a fresh session so the allowlist doesn't block us.
      const sessionId2 = await createDefaultSession(vault, owner, agent.address, usdcAddr, [rwaAddr], [faultyAddr]);
      const spend = ethers.parseUnits("10", 6);
      const minOut = ethers.parseUnits("10", 18);
      const deadline = (await time.latest()) + 3600;

      await expect(
        vault.connect(agent).executeTrade(sessionId2, rwaAddr, spend, minOut, faultyAddr, deadline)
      ).to.be.revertedWith("RoninVault: slippage / insufficient output");
    });

    it("blocks a reentrant call into executeTrade via the venue", async () => {
      const { vault, owner, agent, rwa, usdcAddr, rwaAddr, sessionId } = await loadFixture(sessionFixture);
      const Reentrant = await ethers.getContractFactory("MockReentrantVenue");
      const reentrant = await Reentrant.deploy();
      const reentrantAddr = await reentrant.getAddress();
      await rwa.mint(reentrantAddr, ethers.parseUnits("1000", 18));

      const sessionId2 = await createDefaultSession(vault, owner, agent.address, usdcAddr, [rwaAddr], [reentrantAddr]);
      const spend = ethers.parseUnits("10", 6);
      const minOut = ethers.parseUnits("10", 18);
      const deadline = (await time.latest()) + 3600;

      await reentrant.configure(await vault.getAddress(), sessionId2, rwaAddr, spend, minOut, deadline);

      await expect(
        vault.connect(agent).executeTrade(sessionId2, rwaAddr, spend, minOut, reentrantAddr, deadline)
      ).to.be.revertedWithCustomError(vault, "ReentrancyGuardReentrantCall");
    });
  });

  describe("ETH sessions", () => {
    it("spends escrowed ETH through an allowlisted venue", async () => {
      const { vault, owner, agent, rwa, vaultAddr, rwaAddr } = await loadFixture(deployFixture);

      // Fund the vault with ETH.
      await owner.sendTransaction({ to: vaultAddr, value: ethers.parseEther("5") });

      const Venue = await ethers.getContractFactory("MockRWAVenue");
      const ethVenue = await Venue.deploy(owner.address);
      const ethVenueAddr = await ethVenue.getAddress();
      await rwa.mint(ethVenueAddr, ethers.parseUnits("1000000", 18));
      // 1 ETH -> 2000 RWA (18 decimals both sides)
      await ethVenue
        .connect(owner)
        .setRate(ethers.ZeroAddress, rwaAddr, ethers.parseUnits("2000", 18), ethers.parseUnits("1", 18));

      const sessionId = await createDefaultSession(
        vault,
        owner,
        agent.address,
        ethers.ZeroAddress,
        [rwaAddr],
        [ethVenueAddr],
        { maxPerTx: ethers.parseEther("1"), maxPerPeriod: ethers.parseEther("2") }
      );

      const spend = ethers.parseEther("1");
      const minOut = ethers.parseUnits("2000", 18);
      const deadline = (await time.latest()) + 3600;

      const ethBefore = await ethers.provider.getBalance(vaultAddr);
      await vault.connect(agent).executeTrade(sessionId, rwaAddr, spend, minOut, ethVenueAddr, deadline);
      const ethAfter = await ethers.provider.getBalance(vaultAddr);

      expect(ethBefore - ethAfter).to.equal(spend);
      expect(await rwa.balanceOf(vaultAddr)).to.be.gte(minOut);
    });
  });

  describe("funding & withdrawals", () => {
    it("lets anyone deposit ERC20 but only the owner withdraw", async () => {
      const { vault, owner, agent, other, usdc, usdcAddr, vaultAddr } = await loadFixture(deployFixture);

      await usdc.mint(other.address, ethers.parseUnits("100", 6));
      await usdc.connect(other).approve(vaultAddr, ethers.MaxUint256);
      await expect(vault.connect(other).depositERC20(usdcAddr, ethers.parseUnits("100", 6)))
        .to.emit(vault, "Deposited")
        .withArgs(usdcAddr, other.address, ethers.parseUnits("100", 6));

      await expect(
        vault.connect(agent).withdraw(usdcAddr, ethers.parseUnits("1", 6), agent.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");

      await expect(
        vault.connect(owner).withdraw(usdcAddr, ethers.parseUnits("1", 6), owner.address)
      ).to.changeTokenBalance(usdc, owner, ethers.parseUnits("1", 6));
    });

    it("rejects withdrawing to the zero address", async () => {
      const { vault, owner, usdcAddr } = await loadFixture(deployFixture);
      await expect(
        vault.connect(owner).withdraw(usdcAddr, 1, ethers.ZeroAddress)
      ).to.be.revertedWith("RoninVault: zero recipient");
    });

    it("rejects depositing the zero token address", async () => {
      const { vault, owner } = await loadFixture(deployFixture);
      await expect(vault.connect(owner).depositERC20(ethers.ZeroAddress, 1)).to.be.revertedWith(
        "RoninVault: zero token"
      );
    });

    it("accepts and withdraws native ETH", async () => {
      const { vault, owner, vaultAddr } = await loadFixture(deployFixture);
      await expect(owner.sendTransaction({ to: vaultAddr, value: ethers.parseEther("2") }))
        .to.emit(vault, "Deposited")
        .withArgs(ethers.ZeroAddress, owner.address, ethers.parseEther("2"));

      await expect(
        vault.connect(owner).withdraw(ethers.ZeroAddress, ethers.parseEther("1"), owner.address)
      ).to.changeEtherBalance(owner, ethers.parseEther("1"));
    });
  });
});
