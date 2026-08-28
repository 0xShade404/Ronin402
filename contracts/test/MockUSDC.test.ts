import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { MockUSDC } from "../typechain-types";

async function deployFixture() {
  const [deployer, alice, bob, relayer] = await ethers.getSigners();
  const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
  const token = await MockUSDCFactory.deploy();
  await token.mint(alice.address, ethers.parseUnits("1000", 6));
  return { token, deployer, alice, bob, relayer };
}

async function signAuthorization(
  token: MockUSDC,
  signer: HardhatEthersSigner,
  params: {
    from: string;
    to: string;
    value: bigint;
    validAfter: number;
    validBefore: number;
    nonce: string;
  }
) {
  const { chainId } = await ethers.provider.getNetwork();
  const domain = {
    name: "Mock USD Coin",
    version: "1",
    chainId,
    verifyingContract: await token.getAddress(),
  };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  return signer.signTypedData(domain, types, params);
}

describe("MockUSDC (EIP-3009 transferWithAuthorization)", () => {
  it("moves funds when the authorization is validly signed by `from`", async () => {
    const { token, alice, bob, relayer } = await loadFixture(deployFixture);
    const now = await time.latest();
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const params = {
      from: alice.address,
      to: bob.address,
      value: ethers.parseUnits("10", 6),
      validAfter: 0,
      validBefore: now + 3600,
      nonce,
    };
    const sig = await signAuthorization(token, alice, params);

    await expect(
      token
        .connect(relayer)
        .transferWithAuthorization(
          params.from,
          params.to,
          params.value,
          params.validAfter,
          params.validBefore,
          params.nonce,
          sig
        )
    ).to.changeTokenBalances(token, [alice, bob], [-params.value, params.value]);
  });

  it("rejects replaying an already-used nonce", async () => {
    const { token, alice, bob, relayer } = await loadFixture(deployFixture);
    const now = await time.latest();
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const params = {
      from: alice.address,
      to: bob.address,
      value: ethers.parseUnits("10", 6),
      validAfter: 0,
      validBefore: now + 3600,
      nonce,
    };
    const sig = await signAuthorization(token, alice, params);
    const call = () =>
      token
        .connect(relayer)
        .transferWithAuthorization(
          params.from,
          params.to,
          params.value,
          params.validAfter,
          params.validBefore,
          params.nonce,
          sig
        );

    await call();
    await expect(call()).to.be.revertedWith("MockUSDC: authorization already used");
  });

  it("rejects a signature that doesn't match `from`", async () => {
    const { token, alice, bob, relayer } = await loadFixture(deployFixture);
    const now = await time.latest();
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const params = {
      from: alice.address,
      to: bob.address,
      value: ethers.parseUnits("10", 6),
      validAfter: 0,
      validBefore: now + 3600,
      nonce,
    };
    // Signed by bob, but `from` claims to be alice.
    const sig = await signAuthorization(token, bob, params);

    await expect(
      token
        .connect(relayer)
        .transferWithAuthorization(
          params.from,
          params.to,
          params.value,
          params.validAfter,
          params.validBefore,
          params.nonce,
          sig
        )
    ).to.be.revertedWith("MockUSDC: invalid signature");
  });

  it("rejects an authorization that has already expired", async () => {
    const { token, alice, bob, relayer } = await loadFixture(deployFixture);
    const now = await time.latest();
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const params = {
      from: alice.address,
      to: bob.address,
      value: ethers.parseUnits("10", 6),
      validAfter: 0,
      validBefore: now - 1,
      nonce,
    };
    const sig = await signAuthorization(token, alice, params);

    await expect(
      token
        .connect(relayer)
        .transferWithAuthorization(
          params.from,
          params.to,
          params.value,
          params.validAfter,
          params.validBefore,
          params.nonce,
          sig
        )
    ).to.be.revertedWith("MockUSDC: authorization expired");
  });

  it("rejects an authorization that isn't valid yet", async () => {
    const { token, alice, bob, relayer } = await loadFixture(deployFixture);
    const now = await time.latest();
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const params = {
      from: alice.address,
      to: bob.address,
      value: ethers.parseUnits("10", 6),
      validAfter: now + 3600,
      validBefore: now + 7200,
      nonce,
    };
    const sig = await signAuthorization(token, alice, params);

    await expect(
      token
        .connect(relayer)
        .transferWithAuthorization(
          params.from,
          params.to,
          params.value,
          params.validAfter,
          params.validBefore,
          params.nonce,
          sig
        )
    ).to.be.revertedWith("MockUSDC: authorization not yet valid");
  });

  it("rejects a tampered value even with an otherwise-valid signature", async () => {
    const { token, alice, bob, relayer } = await loadFixture(deployFixture);
    const now = await time.latest();
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const signedValue = ethers.parseUnits("10", 6);
    const params = {
      from: alice.address,
      to: bob.address,
      value: signedValue,
      validAfter: 0,
      validBefore: now + 3600,
      nonce,
    };
    const sig = await signAuthorization(token, alice, params);
    const tamperedValue = ethers.parseUnits("1000", 6);

    await expect(
      token
        .connect(relayer)
        .transferWithAuthorization(params.from, params.to, tamperedValue, params.validAfter, params.validBefore, params.nonce, sig)
    ).to.be.revertedWith("MockUSDC: invalid signature");
  });
});
