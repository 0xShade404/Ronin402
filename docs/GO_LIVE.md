# Going live

This repo runs today on a local test chain. Here's what's left to run it for real.

## 1. Deploy the contracts

Set `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` (or your target chain's
equivalent) in `contracts/`, then:

```
npx hardhat run scripts/deploy.ts --network sepolia
```

On mainnet, point sessions at **real USDC**, not `MockUSDC` — `MockUSDC` is
a test-only faucet token.

## 2. Get a real audit

This build has an AI-assisted security review only (see `docs/SECURITY.md`),
not a professional one. Don't put real funds behind it before one happens.

## 3. Host the resource server

Deploy `server/` somewhere persistent (Fly, Render, a VPS). Set real values
for `RPC_URL`, `FACILITATOR_PRIVATE_KEY` (funded for gas), `ASSET_ADDRESS`,
`PAY_TO_ADDRESS` — see `server/.env.example`.

## 4. Host the static site

Push `index.html`, `dashboard.html`, and `assets/` to Vercel, Netlify, or
GitHub Pages. No build step needed.

## 5. Run the agent

Run `agent/` somewhere persistent (a VM or container), with its own funded
session key, pointed at the deployed vault and hosted server — see
`agent/.env.example`.

## 6. Connect a real settlement venue

`MockRWAVenue` is a test-only fixed-rate swap. You need a real DEX or RWA
venue that implements the `IRwaVenue` interface before any session can
allowlist it.
