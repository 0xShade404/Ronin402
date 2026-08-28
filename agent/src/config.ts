export interface AgentConfig {
  rpcUrl: string;
  /**
   * The agent's session key. Used for two distinct purposes:
   *  1. Signing x402 payment authorizations, drawn from a small operating
   *     balance this address holds directly (NOT the vault's escrowed funds).
   *  2. Submitting `executeTrade` to the vault, which enforces on-chain that
   *     this exact address is the session's authorized agent.
   * It needs a little native ETH for gas and a little of the payment asset
   * to actually pay for quotes/data/execution routes.
   */
  agentPrivateKey: string;
  vaultAddress: string;
  sessionId: bigint;
  serverBaseUrl: string;
  outputToken: string;
  venue: string;
  spendAmount: bigint;
  slippageBps: number;
  pair: string;
  intervalSeconds?: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const intervalRaw = env.INTERVAL_SECONDS;
  return {
    rpcUrl: required(env, "RPC_URL"),
    agentPrivateKey: required(env, "AGENT_PRIVATE_KEY"),
    vaultAddress: required(env, "VAULT_ADDRESS"),
    sessionId: BigInt(required(env, "SESSION_ID")),
    serverBaseUrl: required(env, "SERVER_BASE_URL"),
    outputToken: required(env, "OUTPUT_TOKEN"),
    venue: required(env, "VENUE"),
    spendAmount: BigInt(required(env, "SPEND_AMOUNT")),
    slippageBps: Number(env.SLIPPAGE_BPS ?? "50"),
    pair: env.PAIR ?? "USDC/TBILL",
    intervalSeconds: intervalRaw ? Number(intervalRaw) : undefined,
  };
}
