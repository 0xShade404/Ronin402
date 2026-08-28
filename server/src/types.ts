export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  /** Smallest-unit decimal string, e.g. "1000" for 0.001 mUSDC (6 decimals). */
  maxAmountRequired: string;
  asset: string;
  extra: { name: string; version: string };
  maxTimeoutSeconds: number;
}

export interface Authorization {
  from: string;
  to: string;
  /** Smallest-unit decimal string. */
  value: string;
  validAfter: number;
  validBefore: number;
  /** 0x-prefixed 32-byte hex string. */
  nonce: string;
}

export interface PaymentPayload {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: {
    authorization: Authorization;
    signature: string;
  };
}

export interface SettleResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export interface Facilitator {
  /**
   * Fast, off-chain checks only: does the signature recover to `from`, is the
   * amount/recipient/timing correct. Throws PaymentError on any failure.
   * Does NOT guarantee the authorization hasn't already been spent — that can
   * only be known on-chain, which is why `settle` still has to happen.
   */
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<void>;
  /** Submits the authorization on-chain and reports the outcome. */
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult>;
}
