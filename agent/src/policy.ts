export interface SessionSnapshot {
  agent: string;
  spendToken: string;
  maxPerTx: bigint;
  maxPerPeriod: bigint;
  expiry: bigint;
  revoked: boolean;
}

export class PolicyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolation";
  }
}

/**
 * Off-chain mirror of RoninVault's on-chain checks. This is a courtesy: it
 * saves gas by failing fast on a trade that would definitely revert, and
 * gives the agent operator a clear reason. It is NOT the security boundary —
 * the vault contract enforces every one of these independently on-chain
 * regardless of whether this check ran at all.
 */
export function checkTradePolicy(
  session: SessionSnapshot,
  agentAddress: string,
  spendAmount: bigint,
  availablePeriodBudget: bigint,
  nowSeconds: number
): void {
  if (session.agent.toLowerCase() !== agentAddress.toLowerCase()) {
    throw new PolicyViolation("this wallet is not the session's authorized agent");
  }
  if (session.revoked) {
    throw new PolicyViolation("session has been revoked");
  }
  if (BigInt(nowSeconds) > session.expiry) {
    throw new PolicyViolation("session has expired");
  }
  if (spendAmount <= 0n) {
    throw new PolicyViolation("spend amount must be positive");
  }
  if (spendAmount > session.maxPerTx) {
    throw new PolicyViolation(
      `spend amount ${spendAmount} exceeds the per-transaction cap ${session.maxPerTx}`
    );
  }
  if (spendAmount > availablePeriodBudget) {
    throw new PolicyViolation(
      `spend amount ${spendAmount} exceeds the remaining period budget ${availablePeriodBudget}`
    );
  }
}
