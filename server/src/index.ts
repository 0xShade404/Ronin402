import { createApp } from "./app.js";
import { loadConfigFromEnv } from "./config.js";
import { createOnChainFacilitator } from "./facilitator.js";

const config = loadConfigFromEnv();
const facilitator = createOnChainFacilitator({
  rpcUrl: config.rpcUrl,
  privateKey: config.facilitatorPrivateKey,
  chainId: config.chainId,
});
const app = createApp(facilitator, config);

app.listen(config.port, () => {
  console.log(`Ronin402 x402 resource server listening on :${config.port} (network: ${config.network})`);
});
