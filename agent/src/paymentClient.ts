import { randomBytes } from "node:crypto";
import { hexlify, type TypedDataDomain, type TypedDataField } from "ethers";

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxAmountRequired: string;
  asset: string;
  extra: { name: string; version: string };
  maxTimeoutSeconds: number;
}

interface TypedDataSigner {
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string>;
}

const TRANSFER_WITH_AUTHORIZATION_TYPES: Record<string, TypedDataField[]> = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export async function buildPaymentHeader(
  signer: TypedDataSigner,
  signerAddress: string,
  chainId: number,
  requirements: PaymentRequirements
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // Stay safely inside the server's accepted window rather than pushing right
  // up against it — clock skew between agent and server would otherwise be
  // enough to make a validly-signed authorization get rejected as expired.
  const window = Math.max(30, Math.min(120, requirements.maxTimeoutSeconds - 10));

  const authorization = {
    from: signerAddress,
    to: requirements.payTo,
    value: requirements.maxAmountRequired,
    validAfter: 0,
    validBefore: now + window,
    nonce: hexlify(randomBytes(32)),
  };

  const domain: TypedDataDomain = {
    name: requirements.extra.name,
    version: requirements.extra.version,
    chainId,
    verifyingContract: requirements.asset,
  };

  const signature = await signer.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, authorization);

  const payload = {
    x402Version: 1,
    scheme: requirements.scheme,
    network: requirements.network,
    payload: { authorization, signature },
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export class PaymentFlowError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: unknown) {
    super(message);
    this.name = "PaymentFlowError";
  }
}

/**
 * Performs the full x402 client flow: request the resource, and if the
 * server responds 402, sign a payment authorization for the FIRST accepted
 * requirement and retry once with the X-PAYMENT header attached. Does not
 * retry a second time — a 402 on the retry means something is actually
 * wrong (bad price, wrong network, insufficient balance) rather than "pay
 * and move on".
 */
export async function fetchWithPayment(
  url: string,
  signer: TypedDataSigner,
  signerAddress: string,
  chainId: number,
  init: RequestInit = {}
): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 402) return first;

  const challenge = (await first.json()) as { accepts?: PaymentRequirements[]; error?: string };
  const requirements = challenge.accepts?.[0];
  if (!requirements) {
    throw new PaymentFlowError("server returned 402 with no payment requirements", 402, challenge);
  }

  const header = await buildPaymentHeader(signer, signerAddress, chainId, requirements);
  const retry = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), "X-PAYMENT": header },
  });

  if (retry.status === 402) {
    const body = await retry.json().catch(() => undefined);
    throw new PaymentFlowError("payment was rejected", 402, body);
  }
  if (!retry.ok) {
    const body = await retry.json().catch(() => undefined);
    throw new PaymentFlowError(`request failed with status ${retry.status}`, retry.status, body);
  }

  return retry;
}
