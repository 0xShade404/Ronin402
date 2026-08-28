# Ronin402

**AI agents × x402 × RWAs**

Ronin402 lets an autonomous AI agent trade tokenized real-world assets under
hard, on-chain, owner-defined limits:

- Agents pay for quotes, data & execution via **x402** (the machine-native
  `402 Payment Required` payment flow), from their own small operating
  balance — not the vault's escrowed collateral.
- A smart-contract vault holds the owner's collateral in escrow and enforces
  per-transaction and rolling-period spending caps, an output-token
  allowlist, a venue allowlist, and an expiry on every agent session.
- Once a session is authorized, the agent trades within it autonomously —
  no wallet pop-up per trade.
- ETH-native, non-custodial, permissionless.

This repo is a full local-runnable stack: Solidity contracts, an x402
resource/facilitator server, an agent CLI, a wallet-connected dashboard, and
a marketing landing page — not just the landing page.

## Structure

```
contracts/    Solidity: RoninVault (escrow + session policy + settlement),
              RoninVaultFactory, MockUSDC (EIP-3009), mock venues. Hardhat
              project with a full test suite.
server/       Express x402 resource server: /v1/quote, /v1/data/:asset,
              /v1/execute, gated by a requirePayment middleware that
              verifies an EIP-3009 payment authorization off-chain and
              settles it on-chain via a facilitator wallet.
agent/        Node/TS CLI: signs x402 payments, requests a quote + an
              execution route, then calls executeTrade on the vault.
index.html,   Marketing landing page (lime-green, mobile-first, no
assets/       backend) plus dashboard.html — a static wallet-connected
              control panel (ethers.js + an injected wallet) for loading a
              vault, funding it, creating/revoking agent sessions, and
              pausing/withdrawing.
```

## Trust model (read before connecting real funds)

- The vault **owner** is the only address that can deposit-configure
  sessions, pause, revoke, or withdraw to an arbitrary address.
- An **agent** (a session's authorized address) can only call `executeTrade`
  for its own session, within that session's caps/allowlist/expiry — it can
  never withdraw funds anywhere.
- `minAmountOut` on every trade is caller-supplied and strictly enforced
  on-chain by comparing the vault's actual token balance before/after — that
  guarantee does not depend on a venue's self-reported return value.
- Per-tx/per-period caps bound the blast radius of a compromised or
  misbehaving agent key; they are not a substitute for keeping that key
  secure.
- `/v1/execute`'s response is informational only — nothing about it is
  cryptographically trusted on-chain. The vault only trusts its own
  owner-configured venue allowlist and the `minAmountOut` supplied at call
  time.

## Running it locally

```bash
npm install                       # installs all three workspaces

# Contracts
npm run test:contracts            # Hardhat test suite (35 tests)
cd contracts && npx hardhat node  # local chain, in one terminal
# in another terminal:
npx hardhat run scripts/deploy.ts --network localhost   # deploys RoninVaultFactory only
# or, for a quick funded demo vault + mock tokens/venue/session:
npx hardhat run scripts/dev-deploy.ts --network localhost

# Server (needs a running chain + a deployed EIP-3009 asset — see server/.env.example)
cd server && cp .env.example .env && npm run dev

# Agent (needs a running chain, deployed vault + an active session — see agent/.env.example)
cd agent && cp .env.example .env && npm run dev

# Landing page + dashboard (static, no backend)
python3 -m http.server 8000   # from the repo root, then open /index.html or /dashboard.html
```

## Testing

`npm test` runs the contract suite (Hardhat/Mocha) and the server suite
(Vitest); `npm run test:agent` runs the agent's suite separately. Together:
73 tests covering session policy enforcement, reentrancy, a venue that lies
about its output amount, EIP-3009 signature/replay/timing checks, the x402
402→pay→settle handshake, and the agent's pricing/policy math.

## Status

Testnet-grade reference implementation. The contracts have a thorough
automated test suite and were reviewed by an AI security-review pass (see
`docs/SECURITY.md`) with no confirmed high/medium findings remaining — that
is not a substitute for an independent third-party audit, and none has been
done. Treat mainnet usage as experimental until one has.

## Notes

- The landing page's waitlist form validates email format client-side only;
  it does not submit anywhere.
- Content on the landing/dashboard pages is progressive-enhancement: if
  JavaScript fails to load, sections stay visible rather than hidden.
