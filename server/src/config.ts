export interface PaymentGateConfig {
  rpcUrl: string;
  facilitatorPrivateKey: string;
  chainId: number;
  assetAddress: string;
  assetName: string;
  assetVersion: string;
  payToAddress: string;
  network: string;
  prices: { quote: string; data: string; execute: string };
  port: number;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentGateConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
  };

  return {
    rpcUrl: required("RPC_URL"),
    facilitatorPrivateKey: required("FACILITATOR_PRIVATE_KEY"),
    chainId: Number(env.CHAIN_ID ?? "31337"),
    assetAddress: required("ASSET_ADDRESS"),
    assetName: env.ASSET_NAME ?? "Mock USD Coin",
    assetVersion: env.ASSET_VERSION ?? "1",
    payToAddress: required("PAY_TO_ADDRESS"),
    network: env.NETWORK_LABEL ?? "ronin402-devnet",
    prices: {
      quote: env.PRICE_QUOTE ?? "1000",
      data: env.PRICE_DATA ?? "2000",
      execute: env.PRICE_EXECUTE ?? "5000",
    },
    port: Number(env.PORT ?? "8402"),
  };
}
