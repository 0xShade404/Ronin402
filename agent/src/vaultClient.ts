import { Contract, type ContractTransactionReceipt, type Provider, type Signer } from "ethers";
import type { SessionSnapshot } from "./policy.js";

const VAULT_ABI = [
  "function getSession(uint256 sessionId) view returns (tuple(address agent, address spendToken, uint256 maxPerTx, uint256 maxPerPeriod, uint64 periodDuration, uint64 expiry, bool revoked, uint256 periodStart, uint256 spentInPeriod))",
  "function availablePeriodBudget(uint256 sessionId) view returns (uint256)",
  "function executeTrade(uint256 sessionId, address outputToken, uint256 spendAmount, uint256 minAmountOut, address venue, uint256 deadline) returns (uint256)",
];

const ERC20_ABI = ["function decimals() view returns (uint8)"];

export class VaultClient {
  private readonly contract: Contract;

  constructor(vaultAddress: string, signerOrProvider: Signer | Provider) {
    this.contract = new Contract(vaultAddress, VAULT_ABI, signerOrProvider);
  }

  async getSession(sessionId: bigint): Promise<SessionSnapshot> {
    const raw = await this.contract.getSession(sessionId);
    return {
      agent: raw.agent as string,
      spendToken: raw.spendToken as string,
      maxPerTx: raw.maxPerTx as bigint,
      maxPerPeriod: raw.maxPerPeriod as bigint,
      expiry: raw.expiry as bigint,
      revoked: raw.revoked as boolean,
    };
  }

  async availablePeriodBudget(sessionId: bigint): Promise<bigint> {
    return (await this.contract.availablePeriodBudget(sessionId)) as bigint;
  }

  async executeTrade(
    sessionId: bigint,
    outputToken: string,
    spendAmount: bigint,
    minAmountOut: bigint,
    venue: string,
    deadline: bigint
  ): Promise<ContractTransactionReceipt> {
    const tx = await this.contract.executeTrade(sessionId, outputToken, spendAmount, minAmountOut, venue, deadline);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("executeTrade transaction did not produce a receipt");
    return receipt;
  }
}

export async function readErc20Decimals(tokenAddress: string, provider: Provider): Promise<number> {
  const token = new Contract(tokenAddress, ERC20_ABI, provider);
  return Number(await token.decimals());
}
