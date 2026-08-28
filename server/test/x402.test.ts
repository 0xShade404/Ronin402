import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { Facilitator, PaymentPayload } from "../src/types.js";
import type { PaymentGateConfig } from "../src/config.js";

function baseConfig(): PaymentGateConfig {
  return {
    rpcUrl: "http://localhost:8545",
    facilitatorPrivateKey: "0x" + "1".repeat(64),
    chainId: 31337,
    assetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    assetName: "Mock USD Coin",
    assetVersion: "1",
    payToAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    network: "ronin402-test",
    prices: { quote: "1000", data: "2000", execute: "5000" },
    port: 0,
  };
}

function dummyPayload(overrides: Partial<PaymentPayload["payload"]> = {}): PaymentPayload {
  return {
    x402Version: 1,
    scheme: "exact",
    network: "ronin402-test",
    payload: {
      authorization: {
        from: "0xcccccccccccccccccccccccccccccccccccccccc",
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "1000",
        validAfter: 0,
        validBefore: Math.floor(Date.now() / 1000) + 3600,
        nonce: "0x" + "11".repeat(32),
      },
      signature: "0xdeadbeef",
      ...overrides,
    },
  };
}

function encodeHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

describe("x402 middleware (via /v1/quote)", () => {
  it("returns 402 with payment requirements when no X-PAYMENT header is present", async () => {
    const facilitator: Facilitator = { verify: vi.fn(), settle: vi.fn() };
    const app = createApp(facilitator, baseConfig());

    const res = await request(app).get("/v1/quote");
    expect(res.status).toBe(402);
    expect(res.body.accepts[0].maxAmountRequired).toBe("1000");
    expect(res.body.accepts[0].resource).toBe("/v1/quote");
    expect(facilitator.verify).not.toHaveBeenCalled();
  });

  it("returns 402 with the verify() error message when verification fails, and never calls settle()", async () => {
    const facilitator: Facilitator = {
      verify: vi.fn().mockRejectedValue(new Error("boom")),
      settle: vi.fn(),
    };
    const app = createApp(facilitator, baseConfig());

    const res = await request(app).get("/v1/quote").set("X-PAYMENT", encodeHeader(dummyPayload()));
    expect(res.status).toBe(402);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("returns 402 when verify() passes but settle() fails (e.g. a replayed authorization)", async () => {
    const facilitator: Facilitator = {
      verify: vi.fn().mockResolvedValue(undefined),
      settle: vi.fn().mockResolvedValue({ success: false, error: "authorization already used" }),
    };
    const app = createApp(facilitator, baseConfig());

    const res = await request(app).get("/v1/quote").set("X-PAYMENT", encodeHeader(dummyPayload()));
    expect(res.status).toBe(402);
    expect(res.body.error).toBe("authorization already used");
  });

  it("serves the resource and attaches X-PAYMENT-RESPONSE once settlement succeeds", async () => {
    const facilitator: Facilitator = {
      verify: vi.fn().mockResolvedValue(undefined),
      settle: vi.fn().mockResolvedValue({ success: true, txHash: "0xabc" }),
    };
    const app = createApp(facilitator, baseConfig());

    const res = await request(app).get("/v1/quote").set("X-PAYMENT", encodeHeader(dummyPayload()));
    expect(res.status).toBe(200);
    expect(res.body.pair).toBeDefined();

    const header = res.headers["x-payment-response"];
    expect(header).toBeDefined();
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    expect(decoded.success).toBe(true);
    expect(decoded.txHash).toBe("0xabc");
  });

  it("treats a malformed X-PAYMENT header the same as a missing one", async () => {
    const facilitator: Facilitator = { verify: vi.fn(), settle: vi.fn() };
    const app = createApp(facilitator, baseConfig());

    const res = await request(app).get("/v1/quote").set("X-PAYMENT", "not-base64-json");
    expect(res.status).toBe(402);
    expect(facilitator.verify).not.toHaveBeenCalled();
  });

  it("rejects a payload missing a signature the same as a missing header", async () => {
    const facilitator: Facilitator = { verify: vi.fn(), settle: vi.fn() };
    const app = createApp(facilitator, baseConfig());

    const malformed = { x402Version: 1, scheme: "exact", network: "ronin402-test", payload: { authorization: {} } };
    const header = Buffer.from(JSON.stringify(malformed)).toString("base64");

    const res = await request(app).get("/v1/quote").set("X-PAYMENT", header);
    expect(res.status).toBe(402);
    expect(facilitator.verify).not.toHaveBeenCalled();
  });
});

describe("/v1/execute route logic", () => {
  function paidApp() {
    const facilitator: Facilitator = {
      verify: vi.fn().mockResolvedValue(undefined),
      settle: vi.fn().mockResolvedValue({ success: true, txHash: "0xabc" }),
    };
    return createApp(facilitator, baseConfig());
  }

  it("computes minAmountOut from expectedAmountOut and slippageBps", async () => {
    const res = await request(paidApp())
      .post("/v1/execute")
      .set("X-PAYMENT", encodeHeader(dummyPayload()))
      .send({ venue: "0xVenue", outputToken: "0xOut", expectedAmountOut: "1000000", slippageBps: 100 });

    expect(res.status).toBe(200);
    expect(res.body.minAmountOut).toBe("990000"); // 1% off 1,000,000
    expect(typeof res.body.deadline).toBe("number");
  });

  it("rejects a missing expectedAmountOut with 400", async () => {
    const res = await request(paidApp())
      .post("/v1/execute")
      .set("X-PAYMENT", encodeHeader(dummyPayload()))
      .send({ venue: "0xVenue", outputToken: "0xOut" });

    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range slippageBps with 400", async () => {
    const res = await request(paidApp())
      .post("/v1/execute")
      .set("X-PAYMENT", encodeHeader(dummyPayload()))
      .send({ venue: "0xVenue", outputToken: "0xOut", expectedAmountOut: "1000", slippageBps: 20000 });

    expect(res.status).toBe(400);
  });
});
