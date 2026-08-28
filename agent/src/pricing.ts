import { parseUnits } from "ethers";

/**
 * Converts a spend amount (in the spend token's smallest units) into an
 * expected output amount (in the output token's smallest units), given a
 * decimal price string quoted as "output tokens per 1 whole spend token".
 *
 * Example: spendAmount = 50_000000 (50 mUSDC, 6 decimals), price = "1.0021",
 * outputDecimals = 18 → ~50.105 output tokens, in 18-decimal smallest units.
 */
export function expectedAmountOut(
  spendAmount: bigint,
  price: string,
  spendDecimals: number,
  outputDecimals: number
): bigint {
  if (spendAmount < 0n) throw new RangeError("spendAmount must be non-negative");
  const priceScaled = parseUnits(price, outputDecimals);
  return (spendAmount * priceScaled) / 10n ** BigInt(spendDecimals);
}

/** Applies a slippage tolerance (in basis points) to an expected amount. */
export function applySlippage(expected: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10_000) {
    throw new RangeError("slippageBps must be between 0 and 10000");
  }
  return (expected * BigInt(10_000 - slippageBps)) / 10_000n;
}
