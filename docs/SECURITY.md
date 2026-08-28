# Security review

This document summarizes the security review performed on this build. It is
an AI-assisted internal review, not an independent third-party audit — see
[Scope and limitations](#scope-and-limitations) below.

## Methodology

Two passes:

1. **Design-time**, while writing `contracts/contracts/RoninVault.sol`,
   `server/src/facilitator.ts`, and `assets/js/dashboard.js` — see the
   in-code comments describing the trust model (`RoninVault.sol`'s header
   comment, `routes/execute.ts`'s doc comment). Backed by an automated test
   suite that specifically targets adversarial scenarios: a reentrant venue,
   a venue that lies about its output amount, signature replay/forgery,
   expired/not-yet-valid authorizations, and access-control bypass attempts
   (73 tests total across `contracts/`, `server/`, `agent/`).
2. **Dedicated review pass**, after the full build was complete: a focused
   read-through of every contract, the x402 server's payment-verification
   path, the agent's signing/submission path, and both front-end scripts,
   looking specifically for fund-theft, access-control-bypass,
   signature-verification-bypass, and XSS vulnerabilities.

## Findings

### Fixed: Stored XSS via malicious ERC20 `symbol()` — `assets/js/dashboard.js`

**Severity: High.** `renderSessions()` called an ERC20's `symbol()` view
function and interpolated the raw return value directly into an HTML
template string that was then assigned via `tbody.innerHTML = ...`. Because
`RoninVaultFactory.createVault()` is permissionless, anyone can deploy their
own vault, deploy a malicious ERC20 whose `symbol()` returns markup (e.g.
`<img src=x onerror=...>`), and authorize a session on their own vault using
that token as `spendToken`. Sharing that vault's address with a victim (who
loads it in the dashboard with their own wallet already connected) would
execute attacker-controlled script in the victim's browser, positioned to
solicit further wallet signatures.

**Fix:** every contract-returned `string` (currently just `symbol()`) is now
passed through an `escapeHtml()` helper before being interpolated into an
`innerHTML` template. Regression-tested by deploying a real token with a
`<img onerror=...>` symbol against a local chain and confirming it now
renders as inert text with no `<img>` element created and no handler firing.

### Checked and found sound

- `RoninVault.executeTrade`'s access control (`msg.sender == session.agent`),
  per-tx/rolling-period cap enforcement, output-token/venue allowlists,
  expiry/revocation checks, `ReentrancyGuard` usage, and the balance-delta
  based `minAmountOut` check (which doesn't trust a venue's self-reported
  return value — proven by a dedicated test using a venue that lies about
  it).
- `RoninVaultFactory`'s plain `new RoninVault(...)` deployment (deliberately
  not a clone/proxy factory, to avoid uninitialized-clone front-running as a
  class of bug).
- `MockUSDC.transferWithAuthorization`'s EIP-712 domain/typehash
  construction and `ECDSA.recover`-based signature verification, and its
  on-chain nonce-replay protection.
- `verifyPaymentOffline`'s scheme/network/payTo/amount/timing/signature
  checks in the x402 server, and that the EIP-712 domain used there matches
  the token's actual on-chain domain.
- `script.js` (landing page): no attacker-influenced data paths; existing
  `escapeHtml`/`textContent` usage was already correct.

## Scope and limitations

- This is not a substitute for an independent, professional smart-contract
  audit. No such audit has been performed. Do not deploy this to mainnet
  with real value at stake without one.
- The review covered this repository's own code. It did not re-audit
  OpenZeppelin's contracts, ethers.js, Express, or other third-party
  dependencies — those are widely used, independently audited libraries
  this project relies on rather than reimplements.
- `contracts/contracts/mocks/MockFaultyVenue.sol` and
  `mocks/MockReentrantVenue.sol` are deliberately adversarial contracts that
  exist only to be attacked by the test suite — they are not meant to be
  deployed and are out of scope for "is this contract safe" review.
