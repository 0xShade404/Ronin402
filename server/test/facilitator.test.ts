import { describe, it, expect } from "vitest";
import { Wallet, type TypedDataDomain, type TypedDataField } from "ethers";
import { verifyPaymentOffline } from "../src/facilitator.js";
import { PaymentError } from "../src/errors.js";
import type { Authorization, PaymentPayload, PaymentRequirements } from "../src/types.js";

interface TypedDataSigner {
  address: string;
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string>;
}

const CHAIN_ID = 31337;

const TRANSFER_WITH_AUTHORIZATION_TYPES: Record<string, TypedDataField[]> = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "ronin402-test",
    resource: "/v1/quote",
    description: "test",
    mimeType: "application/json",
    payTo: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    maxAmountRequired: "1000",
    asset: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    extra: { name: "Mock USD Coin", version: "1" },
    maxTimeoutSeconds: 300,
    ...overrides,
  };
}

async function signAuthorization(
  signer: TypedDataSigner,
  req: PaymentRequirements,
  overrides: Partial<Authorization> = {}
): Promise<{ authorization: Authorization; signature: string }> {
  const now = Math.floor(Date.now() / 1000);
  const authorization: Authorization = {
    from: signer.address,
    to: req.payTo,
    value: req.maxAmountRequired,
    validAfter: 0,
    validBefore: now + Math.min(120, req.maxTimeoutSeconds),
    nonce: "0x" + "11".repeat(32),
    ...overrides,
  };
  const domain = {
    name: req.extra.name,
    version: req.extra.version,
    chainId: CHAIN_ID,
    verifyingContract: req.asset,
  };
  const signature = await signer.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, authorization);
  return { authorization, signature };
}

function payloadFrom(req: PaymentRequirements, signed: { authorization: Authorization; signature: string }): PaymentPayload {
  return { x402Version: 1, scheme: req.scheme, network: req.network, payload: signed };
}

describe("verifyPaymentOffline", () => {
  it("accepts a correctly signed, well-formed authorization", async () => {
    const wallet = Wallet.createRandom();
    const req = requirements();
    const signed = await signAuthorization(wallet, req);
    await expect(verifyPaymentOffline(payloadFrom(req, signed), req, CHAIN_ID)).resolves.toBeUndefined();
  });

  it("rejects an amount below the required price", async () => {
    const wallet = Wallet.createRandom();
    const req = requirements();
    const signed = await signAuthorization(wallet, req, { value: "1" });
    await expect(verifyPaymentOffline(payloadFrom(req, signed), req, CHAIN_ID)).rejects.toThrow(PaymentError);
  });

  it("rejects a payTo mismatch", async () => {
    const wallet = Wallet.createRandom();
    const req = requirements();
    const signed = await signAuthorization(wallet, req, {
      to: "0xcccccccccccccccccccccccccccccccccccccccc",
    });
    await expect(verifyPaymentOffline(payloadFrom(req, signed), req, CHAIN_ID)).rejects.toThrow(PaymentError);
  });

  it("rejects a signature produced by a wallet other than the claimed `from`", async () => {
    const claimedSigner = Wallet.createRandom();
    const actualSigner = Wallet.createRandom();
    const req = requirements();
    const now = Math.floor(Date.now() / 1000);
    const authorization: Authorization = {
      from: claimedSigner.address,
      to: req.payTo,
      value: req.maxAmountRequired,
      validAfter: 0,
      validBefore: now + 3600,
      nonce: "0x" + "22".repeat(32),
    };
    const domain = {
      name: req.extra.name,
      version: req.extra.version,
      chainId: CHAIN_ID,
      verifyingContract: req.asset,
    };
    const signature = await actualSigner.signTypedData(
      domain,
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      authorization
    );

    await expect(
      verifyPaymentOffline(payloadFrom(req, { authorization, signature }), req, CHAIN_ID)
    ).rejects.toThrow(PaymentError);
  });

  it("rejects an authorization that has already expired", async () => {
    const wallet = Wallet.createRandom();
    const req = requirements();
    const now = Math.floor(Date.now() / 1000);
    const signed = await signAuthorization(wallet, req, { validBefore: now - 10 });
    await expect(verifyPaymentOffline(payloadFrom(req, signed), req, CHAIN_ID)).rejects.toThrow(PaymentError);
  });

  it("rejects an authorization not yet valid", async () => {
    const wallet = Wallet.createRandom();
    const req = requirements();
    const now = Math.floor(Date.now() / 1000);
    const signed = await signAuthorization(wallet, req, {
      validAfter: now + 3600,
      validBefore: now + 7200,
    });
    await expect(verifyPaymentOffline(payloadFrom(req, signed), req, CHAIN_ID)).rejects.toThrow(PaymentError);
  });

  it("rejects a network mismatch between payload and requirements", async () => {
    const wallet = Wallet.createRandom();
    const req = requirements();
    const signed = await signAuthorization(wallet, req);
    const payload = payloadFrom(req, signed);
    payload.network = "wrong-network";
    await expect(verifyPaymentOffline(payload, req, CHAIN_ID)).rejects.toThrow(PaymentError);
  });

  it("rejects a validity window longer than the accepted maxTimeoutSeconds", async () => {
    const wallet = Wallet.createRandom();
    const req = requirements({ maxTimeoutSeconds: 60 });
    const now = Math.floor(Date.now() / 1000);
    const signed = await signAuthorization(wallet, req, { validBefore: now + 3600 });
    await expect(verifyPaymentOffline(payloadFrom(req, signed), req, CHAIN_ID)).rejects.toThrow(PaymentError);
  });

  it("rejects a tampered amount even though the rest of the authorization was validly signed", async () => {
    const wallet = Wallet.createRandom();
    const req = requirements();
    const signed = await signAuthorization(wallet, req);
    const tampered = { ...signed, authorization: { ...signed.authorization, value: "999999999" } };
    await expect(verifyPaymentOffline(payloadFrom(req, tampered), req, CHAIN_ID)).rejects.toThrow(PaymentError);
  });
});
