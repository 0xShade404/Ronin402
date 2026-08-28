import { JsonRpcProvider, Wallet, ZeroAddress } from "ethers";
import { loadConfigFromEnv } from "./config.js";
import { fetchWithPayment } from "./paymentClient.js";
import { expectedAmountOut, applySlippage } from "./pricing.js";
import { checkTradePolicy } from "./policy.js";
import { VaultClient, readErc20Decimals } from "./vaultClient.js";

const NATIVE_ETH_DECIMALS = 18;

async function runCycle(): Promise<void> {
  const config = loadConfigFromEnv();
  const provider = new JsonRpcProvider(config.rpcUrl);
  const wallet = new Wallet(config.agentPrivateKey, provider);
  const { chainId } = await provider.getNetwork();

  const vault = new VaultClient(config.vaultAddress, wallet);
  const session = await vault.getSession(config.sessionId);
  const budget = await vault.availablePeriodBudget(config.sessionId);

  const now = Math.floor(Date.now() / 1000);
  checkTradePolicy(session, wallet.address, config.spendAmount, budget, now);

  console.log(`[ronin-agent] requesting quote for ${config.pair}...`);
  const quoteRes = await fetchWithPayment(
    `${config.serverBaseUrl}/v1/quote?pair=${encodeURIComponent(config.pair)}`,
    wallet,
    wallet.address,
    Number(chainId),
    { method: "GET" }
  );
  const quote = (await quoteRes.json()) as { price: string };
  console.log(`[ronin-agent] quote: 1 ${config.pair.split("/")[0] ?? "spend"} -> ${quote.price} output`);

  const spendDecimals =
    session.spendToken === ZeroAddress ? NATIVE_ETH_DECIMALS : await readErc20Decimals(session.spendToken, provider);
  const outputDecimals = await readErc20Decimals(config.outputToken, provider);

  const expected = expectedAmountOut(config.spendAmount, quote.price, spendDecimals, outputDecimals);

  console.log(`[ronin-agent] requesting execution route...`);
  const executeRes = await fetchWithPayment(
    `${config.serverBaseUrl}/v1/execute`,
    wallet,
    wallet.address,
    Number(chainId),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue: config.venue,
        outputToken: config.outputToken,
        expectedAmountOut: expected.toString(),
        slippageBps: config.slippageBps,
      }),
    }
  );
  const route = (await executeRes.json()) as { venue: string; outputToken: string; minAmountOut: string; deadline: number };

  const minAmountOut = BigInt(route.minAmountOut);
  const sanityFloor = applySlippage(expected, config.slippageBps);
  if (minAmountOut < sanityFloor) {
    // The server's own minAmountOut is looser than what we'd accept ourselves — refuse to trade.
    throw new Error(
      `execution route's minAmountOut (${minAmountOut}) is worse than our own slippage floor (${sanityFloor})`
    );
  }

  // Re-check policy right before submission — the quote/execute round trip
  // takes real time, during which the owner could have revoked/paused.
  const freshSession = await vault.getSession(config.sessionId);
  const freshBudget = await vault.availablePeriodBudget(config.sessionId);
  checkTradePolicy(freshSession, wallet.address, config.spendAmount, freshBudget, Math.floor(Date.now() / 1000));

  console.log(`[ronin-agent] submitting executeTrade (spend=${config.spendAmount}, minOut=${minAmountOut})...`);
  const receipt = await vault.executeTrade(
    config.sessionId,
    route.outputToken,
    config.spendAmount,
    minAmountOut,
    route.venue,
    BigInt(route.deadline)
  );
  console.log(`[ronin-agent] settled on-chain: ${receipt.hash}`);
}

async function main(): Promise<void> {
  const config = loadConfigFromEnv();

  if (!config.intervalSeconds) {
    await runCycle();
    return;
  }

  console.log(`[ronin-agent] running every ${config.intervalSeconds}s (Ctrl+C to stop)`);
  for (;;) {
    try {
      await runCycle();
    } catch (err) {
      console.error("[ronin-agent] cycle failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((resolve) => setTimeout(resolve, config.intervalSeconds! * 1000));
  }
}

main().catch((err) => {
  console.error("[ronin-agent] fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
