import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Wallet } from "ethers";
import { buildPaymentHeader, fetchWithPayment, PaymentFlowError, type PaymentRequirements } from "../src/paymentClient.js";

const CHAIN_ID = 31337;

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("buildPaymentHeader", () => {
  it("produces a header that decodes to a payload with a valid signature", async () => {
    const wallet = Wallet.createRandom();
    const req = requirements();
    const header = await buildPaymentHeader(wallet, wallet.address, CHAIN_ID, req);

    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    expect(decoded.scheme).toBe("exact");
    expect(decoded.network).toBe("ronin402-test");
    expect(decoded.payload.authorization.from).toBe(wallet.address);
    expect(decoded.payload.authorization.to).toBe(req.payTo);
    expect(decoded.payload.authorization.value).toBe(req.maxAmountRequired);
    expect(typeof decoded.payload.signature).toBe("string");
  });

  it("keeps the signed window inside the server's maxTimeoutSeconds", async () => {
    const wallet = Wallet.createRandom();
    const req = requirements({ maxTimeoutSeconds: 60 });
    const header = await buildPaymentHeader(wallet, wallet.address, CHAIN_ID, req);
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    expect(decoded.payload.authorization.validBefore - now).toBeLessThanOrEqual(60);
  });
});

describe("fetchWithPayment", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns the first response directly when no payment is required", async () => {
    const ok = jsonResponse(200, { hello: "world" });
    global.fetch = vi.fn().mockResolvedValue(ok);

    const wallet = Wallet.createRandom();
    const res = await fetchWithPayment("http://x/v1/quote", wallet, wallet.address, CHAIN_ID);
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("pays and retries once when the server responds 402", async () => {
    const challenge = jsonResponse(402, { x402Version: 1, accepts: [requirements()] });
    const success = jsonResponse(200, { price: "1.0" });
    const fetchMock = vi.fn().mockResolvedValueOnce(challenge).mockResolvedValueOnce(success);
    global.fetch = fetchMock;

    const wallet = Wallet.createRandom();
    const res = await fetchWithPayment("http://x/v1/quote", wallet, wallet.address, CHAIN_ID);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallInit = fetchMock.mock.calls[1][1];
    expect(secondCallInit.headers["X-PAYMENT"]).toBeDefined();
  });

  it("throws PaymentFlowError if the retried request is still rejected with 402", async () => {
    const challenge = jsonResponse(402, { x402Version: 1, accepts: [requirements()] });
    const stillRejected = jsonResponse(402, { error: "insufficient funds" });
    global.fetch = vi.fn().mockResolvedValueOnce(challenge).mockResolvedValueOnce(stillRejected);

    const wallet = Wallet.createRandom();
    await expect(fetchWithPayment("http://x/v1/quote", wallet, wallet.address, CHAIN_ID)).rejects.toThrow(
      PaymentFlowError
    );
  });

  it("throws PaymentFlowError when the 402 challenge itself is malformed", async () => {
    const malformedChallenge = jsonResponse(402, { x402Version: 1 }); // no `accepts`
    global.fetch = vi.fn().mockResolvedValueOnce(malformedChallenge);

    const wallet = Wallet.createRandom();
    await expect(fetchWithPayment("http://x/v1/quote", wallet, wallet.address, CHAIN_ID)).rejects.toThrow(
      PaymentFlowError
    );
  });
});
