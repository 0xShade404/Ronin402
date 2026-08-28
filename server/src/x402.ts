import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { Facilitator, PaymentPayload, PaymentRequirements } from "./types.js";
import { PaymentError } from "./errors.js";

export interface RequirePaymentOptions {
  /** Smallest-unit decimal string, e.g. "1000" for 0.001 mUSDC (6 decimals). */
  price: string;
  asset: string;
  payTo: string;
  network: string;
  description: string;
  assetName: string;
  assetVersion: string;
  maxTimeoutSeconds?: number;
}

export function buildRequirements(resourcePath: string, opts: RequirePaymentOptions): PaymentRequirements {
  return {
    scheme: "exact",
    network: opts.network,
    resource: resourcePath,
    description: opts.description,
    mimeType: "application/json",
    payTo: opts.payTo,
    maxAmountRequired: opts.price,
    asset: opts.asset,
    extra: { name: opts.assetName, version: opts.assetVersion },
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 300,
  };
}

export function decodePaymentHeader(header: string | undefined): PaymentPayload | undefined {
  if (!header) return undefined;
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.payload !== "object" ||
      typeof parsed.payload.authorization !== "object" ||
      typeof parsed.payload.signature !== "string"
    ) {
      return undefined;
    }
    return parsed as PaymentPayload;
  } catch {
    return undefined;
  }
}

export function encodePaymentResponse(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

/**
 * Express middleware implementing the resource-server side of x402: if the
 * request carries no (or an invalid/insufficient) X-PAYMENT header, respond
 * 402 with the payment requirements the caller must satisfy. Otherwise
 * verify the payment off-chain, settle it on-chain via the facilitator, and
 * only call `next()` once settlement actually succeeded.
 */
export function requirePayment(facilitator: Facilitator, opts: RequirePaymentOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const requirements = buildRequirements(req.originalUrl, opts);
    const payload = decodePaymentHeader(req.header("X-PAYMENT"));

    if (!payload) {
      res.status(402).json({ x402Version: 1, accepts: [requirements] });
      return;
    }

    try {
      await facilitator.verify(payload, requirements);
    } catch (err) {
      const message = err instanceof PaymentError ? err.message : "invalid payment";
      res.status(402).json({ x402Version: 1, accepts: [requirements], error: message });
      return;
    }

    let result;
    try {
      result = await facilitator.settle(payload, requirements);
    } catch (err) {
      res.status(502).json({
        x402Version: 1,
        accepts: [requirements],
        error: err instanceof Error ? err.message : "settlement failed unexpectedly",
      });
      return;
    }

    if (!result.success) {
      res.status(402).json({ x402Version: 1, accepts: [requirements], error: result.error ?? "settlement failed" });
      return;
    }

    res.setHeader(
      "X-PAYMENT-RESPONSE",
      encodePaymentResponse({ success: true, txHash: result.txHash, network: opts.network })
    );
    next();
  };
}
