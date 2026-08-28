import { Router } from "express";
import type { Facilitator } from "../types.js";
import { requirePayment } from "../x402.js";
import type { PaymentGateConfig } from "../config.js";

/**
 * Returns an *informational* settlement route for the agent to submit
 * directly to its own RoninVault. Nothing in this response is
 * cryptographically trusted on-chain: the vault only trusts its
 * owner-configured venue allowlist and the caller-supplied `minAmountOut`
 * at call time. This endpoint is metered via x402 because computing a route
 * has a real cost, not because the route itself is any kind of on-chain
 * authorization.
 */
export function executeRouter(facilitator: Facilitator, config: PaymentGateConfig): Router {
  const router = Router();

  router.post(
    "/v1/execute",
    requirePayment(facilitator, {
      price: config.prices.execute,
      asset: config.assetAddress,
      payTo: config.payToAddress,
      network: config.network,
      description: "Execution route for settling a trade on a RoninVault session",
      assetName: config.assetName,
      assetVersion: config.assetVersion,
    }),
    (req, res) => {
      const body = req.body ?? {};
      const { venue, outputToken, expectedAmountOut, slippageBps } = body;

      if (typeof venue !== "string" || typeof outputToken !== "string" || typeof expectedAmountOut !== "string") {
        res.status(400).json({
          error: "venue, outputToken (addresses) and expectedAmountOut (smallest-unit string) are required",
        });
        return;
      }

      let expected: bigint;
      try {
        expected = BigInt(expectedAmountOut);
      } catch {
        res.status(400).json({ error: "expectedAmountOut must be an integer string" });
        return;
      }

      const bps = BigInt(slippageBps ?? 50); // default 0.5% tolerance
      if (bps < 0n || bps > 10_000n) {
        res.status(400).json({ error: "slippageBps must be between 0 and 10000" });
        return;
      }

      const minAmountOut = (expected * (10_000n - bps)) / 10_000n;
      res.json({
        venue,
        outputToken,
        minAmountOut: minAmountOut.toString(),
        deadline: Math.floor(Date.now() / 1000) + 300,
      });
    }
  );

  return router;
}
