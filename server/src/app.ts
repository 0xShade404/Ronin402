import express, { type Express } from "express";
import type { Facilitator } from "./types.js";
import type { PaymentGateConfig } from "./config.js";
import { quoteRouter } from "./routes/quote.js";
import { dataRouter } from "./routes/data.js";
import { executeRouter } from "./routes/execute.js";

export function createApp(facilitator: Facilitator, config: PaymentGateConfig): Express {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, network: config.network });
  });

  app.use(quoteRouter(facilitator, config));
  app.use(dataRouter(facilitator, config));
  app.use(executeRouter(facilitator, config));

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  return app;
}
