# Ronin402

**AI agents × x402 × RWAs**

A static, mobile-friendly landing page for Ronin402 — a concept for letting
autonomous AI agents trade tokenized real-world assets on Ethereum:

- Agents pay for quotes, data & execution via **x402** (the machine-native
  `402 Payment Required` payment flow)
- Smart contracts handle limits, escrow & settlement
- Automated RWA trading without constant user approval
- ETH-native, permissionless, degen UX

## Structure

```
index.html              Page markup (hero, features, how-it-works,
                         architecture, security, FAQ, waitlist, footer)
assets/css/styles.css    Lime-green dark theme, mobile-first responsive CSS
assets/js/script.js      Nav toggle, FAQ accordion, scroll reveal,
                         terminal demo animation, waitlist form validation
```

No build step and no backend — open `index.html` directly or serve the
folder with any static file server, e.g.:

```
python3 -m http.server 8000
```

## Notes

- The waitlist form validates email input client-side only; it does not
  submit anywhere. Wire it up to a real endpoint before using it to
  actually collect emails.
- Content is currently in progressive-enhancement mode: if JavaScript
  fails to load, all sections remain fully visible (no reveal-on-scroll
  animation, but nothing is hidden).
