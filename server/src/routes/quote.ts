import { Router } from "express";
import type { Facilitator } from "../types.js";
import { requirePayment } from "../x402.js";
import type { PaymentGateConfig } from "../config.js";

export function quoteRouter(facilitator: Facilitator, config: PaymentGateConfig): Router {
  const router = Router();

  router.get(
    "/v1/quote",
    requirePayment(facilitator, {
      price: config.prices.quote,
      asset: config.assetAddress,
      payTo: config.payToAddress,
      network: config.network,
      description: "Real-time price quote for a tokenized RWA pair",
      assetName: config.assetName,
      assetVersion: config.assetVersion,
    }),
    (req, res) => {
      const pair = typeof req.query.pair === "string" ? req.query.pair : "USDC/TBILL";
      res.json({ pair, price: "1.0021", timestamp: Date.now() });
    }
  );

  return router;
}
