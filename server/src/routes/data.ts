import { Router } from "express";
import type { Facilitator } from "../types.js";
import { requirePayment } from "../x402.js";
import type { PaymentGateConfig } from "../config.js";

export function dataRouter(facilitator: Facilitator, config: PaymentGateConfig): Router {
  const router = Router();

  router.get(
    "/v1/data/:asset",
    requirePayment(facilitator, {
      price: config.prices.data,
      asset: config.assetAddress,
      payTo: config.payToAddress,
      network: config.network,
      description: "Historical price series for a tokenized RWA",
      assetName: config.assetName,
      assetVersion: config.assetVersion,
    }),
    (req, res) => {
      const now = Date.now();
      res.json({
        asset: req.params.asset,
        series: [
          { t: now - 3_600_000, v: "1.0010" },
          { t: now - 1_800_000, v: "1.0016" },
          { t: now, v: "1.0021" },
        ],
      });
    }
  );

  return router;
}
