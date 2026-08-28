import { describe, it, expect } from "vitest";
import { parseUnits } from "ethers";
import { expectedAmountOut, applySlippage } from "../src/pricing.js";

describe("expectedAmountOut", () => {
  it("converts spend units to output units at a 1:1 price across differing decimals", () => {
    const spend = parseUnits("50", 6); // 50 mUSDC
    const out = expectedAmountOut(spend, "1.0", 6, 18);
    expect(out).toBe(parseUnits("50", 18));
  });

  it("applies a non-trivial decimal price correctly", () => {
    const spend = parseUnits("100", 6); // 100 mUSDC
    const out = expectedAmountOut(spend, "1.0021", 6, 18);
    expect(out).toBe(parseUnits("100.21", 18));
  });

  it("handles equal decimals between spend and output tokens", () => {
    const spend = parseUnits("10", 18);
    const out = expectedAmountOut(spend, "2.5", 18, 18);
    expect(out).toBe(parseUnits("25", 18));
  });

  it("rejects a negative spend amount", () => {
    expect(() => expectedAmountOut(-1n, "1.0", 6, 18)).toThrow(RangeError);
  });
});

describe("applySlippage", () => {
  it("reduces the expected amount by the given basis points", () => {
    expect(applySlippage(1_000_000n, 100)).toBe(990_000n); // 1%
    expect(applySlippage(1_000_000n, 0)).toBe(1_000_000n);
    expect(applySlippage(1_000_000n, 10_000)).toBe(0n); // 100% off
  });

  it("rejects an out-of-range basis-point value", () => {
    expect(() => applySlippage(1_000n, -1)).toThrow(RangeError);
    expect(() => applySlippage(1_000n, 10_001)).toThrow(RangeError);
  });
});
