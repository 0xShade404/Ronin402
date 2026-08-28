import { Contract, JsonRpcProvider, Wallet, verifyTypedData, type TypedDataField } from "ethers";
import type { Facilitator, PaymentPayload, PaymentRequirements, SettleResult } from "./types.js";
import { PaymentError } from "./errors.js";

const EIP3009_ABI = [
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature) external",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
];

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

export interface OnChainFacilitatorConfig {
  rpcUrl: string;
  privateKey: string;
  chainId: number;
}

/**
 * Runs the off-chain verify() checks that any EIP-3009 based x402 facilitator
 * needs, independent of how settlement is actually submitted. Exported so
 * tests (and alternative settlement backends) can reuse it without needing a
 * live chain.
 */
export async function verifyPaymentOffline(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  chainId: number
): Promise<void> {
  if (payload.scheme !== requirements.scheme) {
    throw new PaymentError("scheme mismatch");
  }
  if (payload.network !== requirements.network) {
    throw new PaymentError("network mismatch");
  }

  const { authorization, signature } = payload.payload;

  let value: bigint;
  let required: bigint;
  try {
    value = BigInt(authorization.value);
    required = BigInt(requirements.maxAmountRequired);
  } catch {
    throw new PaymentError("malformed payment amount");
  }

  if (authorization.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    throw new PaymentError("payment not addressed to the expected payee");
  }
  if (value < required) {
    throw new PaymentError("payment amount below the required price");
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= authorization.validAfter) {
    throw new PaymentError("authorization not yet valid");
  }
  if (now >= authorization.validBefore) {
    throw new PaymentError("authorization expired");
  }
  if (authorization.validBefore - now > requirements.maxTimeoutSeconds) {
    throw new PaymentError("authorization window exceeds the accepted timeout");
  }

  const domain = {
    name: requirements.extra.name,
    version: requirements.extra.version,
    chainId,
    verifyingContract: requirements.asset,
  };

  let recovered: string;
  try {
    recovered = verifyTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, authorization, signature);
  } catch {
    throw new PaymentError("malformed payment signature");
  }
  if (recovered.toLowerCase() !== authorization.from.toLowerCase()) {
    throw new PaymentError("payment signature does not match `from`");
  }
}

/**
 * Facilitator backed by a real (or local test) EVM chain: verifies
 * off-chain, then submits `transferWithAuthorization` on-chain using the
 * facilitator's own wallet, which pays the gas.
 */
export function createOnChainFacilitator(config: OnChainFacilitatorConfig): Facilitator {
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);
  const wallet = new Wallet(config.privateKey, provider);

  async function verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<void> {
    await verifyPaymentOffline(payload, requirements, config.chainId);
  }

  async function settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult> {
    const token = new Contract(requirements.asset, EIP3009_ABI, wallet);
    const { authorization, signature } = payload.payload;

    try {
      const alreadyUsed: boolean = await token.authorizationState(authorization.from, authorization.nonce);
      if (alreadyUsed) {
        return { success: false, error: "authorization already used" };
      }

      const tx = await token.transferWithAuthorization(
        authorization.from,
        authorization.to,
        authorization.value,
        authorization.validAfter,
        authorization.validBefore,
        authorization.nonce,
        signature
      );
      const receipt = await tx.wait();
      return { success: true, txHash: receipt?.hash ?? tx.hash };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "settlement failed" };
    }
  }

  return { verify, settle };
}
