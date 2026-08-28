import { describe, it, expect } from "vitest";
import { checkTradePolicy, PolicyViolation, type SessionSnapshot } from "../src/policy.js";

const AGENT = "0x1111111111111111111111111111111111111a";
const OTHER = "0x2222222222222222222222222222222222222b";

function baseSession(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    agent: AGENT,
    spendToken: "0x0000000000000000000000000000000000dEaD",
    maxPerTx: 1_000n,
    maxPerPeriod: 5_000n,
    expiry: 2_000_000_000n, // far future
    revoked: false,
    ...overrides,
  };
}

describe("checkTradePolicy", () => {
  it("passes for a well-formed in-policy trade", () => {
    expect(() => checkTradePolicy(baseSession(), AGENT, 500n, 2_000n, 1_700_000_000)).not.toThrow();
  });

  it("is case-insensitive when comparing the agent address", () => {
    const session = baseSession({ agent: AGENT.toUpperCase().replace("0X", "0x") });
    expect(() => checkTradePolicy(session, AGENT, 500n, 2_000n, 1_700_000_000)).not.toThrow();
  });

  it("rejects a caller that isn't the session's agent", () => {
    expect(() => checkTradePolicy(baseSession(), OTHER, 500n, 2_000n, 1_700_000_000)).toThrow(PolicyViolation);
  });

  it("rejects a revoked session", () => {
    const session = baseSession({ revoked: true });
    expect(() => checkTradePolicy(session, AGENT, 500n, 2_000n, 1_700_000_000)).toThrow(PolicyViolation);
  });

  it("rejects an expired session", () => {
    const session = baseSession({ expiry: 1_000n });
    expect(() => checkTradePolicy(session, AGENT, 500n, 2_000n, 1_700_000_000)).toThrow(PolicyViolation);
  });

  it("rejects a non-positive spend amount", () => {
    expect(() => checkTradePolicy(baseSession(), AGENT, 0n, 2_000n, 1_700_000_000)).toThrow(PolicyViolation);
  });

  it("rejects a spend amount over the per-transaction cap", () => {
    expect(() => checkTradePolicy(baseSession(), AGENT, 1_001n, 5_000n, 1_700_000_000)).toThrow(PolicyViolation);
  });

  it("rejects a spend amount over the remaining period budget", () => {
    expect(() => checkTradePolicy(baseSession(), AGENT, 900n, 500n, 1_700_000_000)).toThrow(PolicyViolation);
  });
});
