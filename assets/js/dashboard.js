(function () {
  "use strict";

  if (typeof window.ethers === "undefined") {
    console.error("[dashboard] ethers.js failed to load from CDN — the dashboard cannot function.");
    return;
  }
  const { ethers } = window;

  const VAULT_ABI = [
    "function owner() view returns (address)",
    "function paused() view returns (bool)",
    "function nextSessionId() view returns (uint256)",
    "function getSession(uint256 sessionId) view returns (tuple(address agent, address spendToken, uint256 maxPerTx, uint256 maxPerPeriod, uint64 periodDuration, uint64 expiry, bool revoked, uint256 periodStart, uint256 spentInPeriod))",
    "function availablePeriodBudget(uint256 sessionId) view returns (uint256)",
    "function depositERC20(address token, uint256 amount)",
    "function withdraw(address token, uint256 amount, address to)",
    "function createSession(address agent, address spendToken, uint256 maxPerTx, uint256 maxPerPeriod, uint64 periodDuration, uint64 expiry, address[] outputTokens, address[] venues) returns (uint256)",
    "function revokeSession(uint256 sessionId)",
    "function pause()",
    "function unpause()",
    "event Deposited(address indexed token, address indexed from, uint256 amount)",
    "event Withdrawn(address indexed token, address indexed to, uint256 amount)",
    "event SessionCreated(uint256 indexed sessionId, address indexed agent, address spendToken, uint256 maxPerTx, uint256 maxPerPeriod, uint64 periodDuration, uint64 expiry)",
    "event SessionRevoked(uint256 indexed sessionId)",
    "event TradeExecuted(uint256 indexed sessionId, address indexed agent, address spendToken, uint256 spendAmount, address outputToken, uint256 amountOut, address venue)",
  ];

  const FACTORY_ABI = [
    "function createVault() returns (address)",
    "function vaultsOf(address owner, uint256 index) view returns (address)",
    "function vaultCountOf(address owner) view returns (uint256)",
    "event VaultCreated(address indexed owner, address indexed vault)",
  ];

  const ERC20_ABI = [
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];

  const ACTIVITY_LOOKBACK_BLOCKS = 20_000n;
  const ACTIVITY_MAX_ITEMS = 25;

  /** @type {{provider: any, signer: any, address: string|null, chainId: bigint|null, vault: any|null, vaultAddress: string|null}} */
  const state = {
    provider: null,
    signer: null,
    address: null,
    chainId: null,
    vault: null,
    vaultAddress: null,
  };

  const decimalsCache = new Map(); // tokenAddress(lowercase) -> number

  // ---------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  function setStatus(message, tone) {
    const banner = $("status-banner");
    if (!banner) return;
    banner.textContent = message;
    banner.dataset.tone = tone || "";
    banner.hidden = false;
  }

  function describeError(err) {
    if (!err) return "Unknown error";
    if (err.shortMessage) return err.shortMessage;
    if (err.reason) return err.reason;
    if (err.info && err.info.error && err.info.error.message) return err.info.error.message;
    if (err.message) return err.message;
    return String(err);
  }

  function isValidAddress(value) {
    try {
      return ethers.isAddress(value);
    } catch {
      return false;
    }
  }

  function short(address) {
    if (!address) return "—";
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }

  /**
   * Escapes a string before it's interpolated into an innerHTML template.
   * Required for ANY value that ultimately comes from a contract call whose
   * return type is a free-form `string` (e.g. ERC20 `symbol()`/`name()`) —
   * unlike an `address`, a token contract fully controls that string and can
   * make it arbitrary markup. Addresses, numbers, and our own literal text
   * don't need this, but token metadata always does.
   */
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function runTx(label, fn) {
    try {
      setStatus(`${label}: waiting for wallet confirmation…`, "pending");
      const tx = await fn();
      setStatus(`${label}: transaction sent (${short(tx.hash)}), waiting for confirmation…`, "pending");
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        throw new Error("transaction reverted");
      }
      setStatus(`${label}: confirmed (${short(receipt.hash)}).`, "ok");
      return receipt;
    } catch (err) {
      setStatus(`${label} failed: ${describeError(err)}`, "error");
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Token helpers
  // ---------------------------------------------------------------------

  async function getDecimals(tokenAddress) {
    if (tokenAddress === ethers.ZeroAddress) return 18;
    const key = tokenAddress.toLowerCase();
    if (decimalsCache.has(key)) return decimalsCache.get(key);
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, state.provider);
      const decimals = Number(await token.decimals());
      decimalsCache.set(key, decimals);
      return decimals;
    } catch {
      // Not every allowlisted "token" is a standard ERC20 we can introspect from a
      // read-only call (or the RPC may be unreachable) — fall back to a common default
      // rather than breaking the whole render.
      return 18;
    }
  }

  async function getSymbol(tokenAddress) {
    if (tokenAddress === ethers.ZeroAddress) return "ETH";
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, state.provider);
      return await token.symbol();
    } catch {
      return short(tokenAddress);
    }
  }

  // ---------------------------------------------------------------------
  // Wallet connection
  // ---------------------------------------------------------------------

  async function connectWallet() {
    if (!window.ethereum) {
      setStatus("No injected wallet found. Install MetaMask (or a similar wallet) and reload.", "error");
      return;
    }
    try {
      state.provider = new ethers.BrowserProvider(window.ethereum);
      await state.provider.send("eth_requestAccounts", []);
      state.signer = await state.provider.getSigner();
      state.address = await state.signer.getAddress();
      const network = await state.provider.getNetwork();
      state.chainId = network.chainId;

      $("wallet-chip").hidden = false;
      $("wallet-address").textContent = short(state.address);
      $("wallet-network").textContent = `chain ${state.chainId}`;
      $("connect-btn").textContent = "Wallet connected";
      $("connect-btn-mobile").textContent = "Wallet connected";
      setStatus(`Connected as ${short(state.address)}.`, "ok");

      if (state.vaultAddress) await loadVault(state.vaultAddress);
    } catch (err) {
      setStatus(`Could not connect wallet: ${describeError(err)}`, "error");
    }
  }

  function watchProviderEvents() {
    if (!window.ethereum || !window.ethereum.on) return;
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged", () => window.location.reload());
  }

  // ---------------------------------------------------------------------
  // Vault loading & rendering
  // ---------------------------------------------------------------------

  async function loadVault(address) {
    if (!isValidAddress(address)) {
      setStatus("That doesn't look like a valid vault address.", "error");
      return;
    }
    if (!state.provider) {
      // Allow read-only browsing before a wallet is connected, via a public RPC
      // the page doesn't control — but without a signer, write actions stay disabled.
      setStatus("Connect a wallet first to load and interact with a vault.", "error");
      return;
    }

    try {
      const runner = state.signer || state.provider;
      const vault = new ethers.Contract(address, VAULT_ABI, runner);
      // Cheap call to confirm there's really a RoninVault-shaped contract here.
      await vault.owner();

      state.vault = vault;
      state.vaultAddress = address;
      $("vault-address-input").value = address;
      $("vault-panels").hidden = false;
      $("sessions-card").hidden = false;
      $("activity-card").hidden = false;

      await renderOverview();
      await renderSessions();
      await renderActivity();
      setStatus(`Loaded vault ${short(address)}.`, "ok");
    } catch (err) {
      setStatus(`Could not load that vault: ${describeError(err)}`, "error");
    }
  }

  async function renderOverview() {
    const vault = state.vault;
    const [owner, paused, ethBalance] = await Promise.all([
      vault.owner(),
      vault.paused(),
      state.provider.getBalance(state.vaultAddress),
    ]);

    $("stat-vault-address").textContent = state.vaultAddress;
    $("stat-owner").textContent = owner;
    $("stat-status").textContent = paused ? "Paused" : "Active";
    $("stat-eth-balance").textContent = `${ethers.formatEther(ethBalance)} ETH`;

    const isOwner = state.address && owner.toLowerCase() === state.address.toLowerCase();
    $("stat-role").textContent = isOwner ? "Owner" : state.address ? "Viewer / possible agent" : "Not connected";

    document.querySelectorAll(".owner-only").forEach((el) => {
      el.hidden = !isOwner;
    });
    $("pause-controls").hidden = !isOwner;
    if (isOwner) {
      $("pause-btn").disabled = paused;
      $("unpause-btn").disabled = !paused;
    }
  }

  async function renderSessions() {
    const vault = state.vault;
    const tbody = $("sessions-tbody");
    const count = await vault.nextSessionId();
    const owner = (await vault.owner()).toLowerCase();
    const isOwner = state.address && owner === state.address.toLowerCase();

    if (count === 0n) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No sessions created yet.</td></tr>';
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const rows = [];

    for (let i = 0n; i < count; i++) {
      const [session, budget] = await Promise.all([vault.getSession(i), vault.availablePeriodBudget(i)]);
      const decimals = await getDecimals(session.spendToken);
      const symbol = escapeHtml(await getSymbol(session.spendToken));

      let statusLabel = "Active";
      let statusClass = "status-pill--active";
      if (session.revoked) {
        statusLabel = "Revoked";
        statusClass = "status-pill--revoked";
      } else if (Number(session.expiry) < now) {
        statusLabel = "Expired";
        statusClass = "status-pill--expired";
      }

      const actionCell =
        isOwner && !session.revoked
          ? `<button class="btn btn--outline btn--tiny" data-revoke-session="${i}">Revoke</button>`
          : "";

      rows.push(`
        <tr>
          <td>${i}</td>
          <td class="mono" title="${session.agent}">${short(session.agent)}</td>
          <td>${symbol}</td>
          <td>${ethers.formatUnits(session.maxPerTx, decimals)}</td>
          <td>${ethers.formatUnits(budget, decimals)}</td>
          <td>${new Date(Number(session.expiry) * 1000).toLocaleDateString()}</td>
          <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
          <td class="owner-only">${actionCell}</td>
        </tr>
      `);
    }

    tbody.innerHTML = rows.join("");
    tbody.querySelectorAll("[data-revoke-session]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const sessionId = btn.getAttribute("data-revoke-session");
        try {
          await runTx(`Revoke session #${sessionId}`, () => vault.revokeSession(sessionId));
          await renderSessions();
          await renderActivity();
        } catch {
          /* status already reported by runTx */
        }
      });
    });
  }

  async function renderActivity() {
    const vault = state.vault;
    const feed = $("activity-feed");
    feed.innerHTML = '<li class="empty-row">Loading activity…</li>';

    try {
      const latest = await state.provider.getBlockNumber();
      const fromBlock = latest > ACTIVITY_LOOKBACK_BLOCKS ? Number(BigInt(latest) - ACTIVITY_LOOKBACK_BLOCKS) : 0;

      const filters = [
        vault.filters.TradeExecuted(),
        vault.filters.SessionCreated(),
        vault.filters.SessionRevoked(),
        vault.filters.Deposited(),
        vault.filters.Withdrawn(),
      ];

      const results = await Promise.all(filters.map((f) => vault.queryFilter(f, fromBlock, latest)));
      const events = results.flat().sort((a, b) => {
        if (b.blockNumber !== a.blockNumber) return b.blockNumber - a.blockNumber;
        return b.transactionIndex - a.transactionIndex;
      });

      if (events.length === 0) {
        feed.innerHTML = '<li class="empty-row">No activity in the recent block range.</li>';
        return;
      }

      const items = await Promise.all(
        events.slice(0, ACTIVITY_MAX_ITEMS).map(async (event) => {
          const detail = await describeEvent(event);
          return `<li><span class="activity-kind">${event.fragment ? event.fragment.name : "Event"}</span><span class="activity-detail">${detail}</span></li>`;
        })
      );
      feed.innerHTML = items.join("");
    } catch (err) {
      feed.innerHTML = `<li class="empty-row">Could not load activity: ${describeError(err)}</li>`;
    }
  }

  async function describeEvent(event) {
    const args = event.args;
    switch (event.fragment ? event.fragment.name : "") {
      case "TradeExecuted": {
        const decimals = await getDecimals(args.spendToken);
        return `session #${args.sessionId} spent ${ethers.formatUnits(args.spendAmount, decimals)} via ${short(args.venue)}`;
      }
      case "SessionCreated":
        return `session #${args.sessionId} for agent ${short(args.agent)}`;
      case "SessionRevoked":
        return `session #${args.sessionId} revoked`;
      case "Deposited": {
        const decimals = await getDecimals(args.token);
        return `${ethers.formatUnits(args.amount, decimals)} from ${short(args.from)}`;
      }
      case "Withdrawn": {
        const decimals = await getDecimals(args.token);
        return `${ethers.formatUnits(args.amount, decimals)} to ${short(args.to)}`;
      }
      default:
        return event.transactionHash;
    }
  }

  // ---------------------------------------------------------------------
  // Factory actions
  // ---------------------------------------------------------------------

  async function listMyVaults() {
    const factoryAddress = $("factory-address-input").value.trim();
    if (!isValidAddress(factoryAddress)) {
      setStatus("Enter a valid factory address first.", "error");
      return;
    }
    if (!state.signer) {
      setStatus("Connect a wallet first.", "error");
      return;
    }
    try {
      const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, state.provider);
      const count = await factory.vaultCountOf(state.address);
      const list = $("my-vaults-list");
      if (count === 0n) {
        list.innerHTML = "<li>No vaults found for this address on this factory.</li>";
        return;
      }
      const items = [];
      for (let i = 0n; i < count; i++) {
        const addr = await factory.vaultsOf(state.address, i);
        items.push(`<li><span class="mono">${addr}</span><button class="btn btn--outline btn--tiny" data-load-vault="${addr}">Load</button></li>`);
      }
      list.innerHTML = items.join("");
      list.querySelectorAll("[data-load-vault]").forEach((btn) => {
        btn.addEventListener("click", () => loadVault(btn.getAttribute("data-load-vault")));
      });
    } catch (err) {
      setStatus(`Could not list vaults: ${describeError(err)}`, "error");
    }
  }

  async function createVaultFromFactory() {
    const factoryAddress = $("factory-address-input").value.trim();
    if (!isValidAddress(factoryAddress)) {
      setStatus("Enter a valid factory address first.", "error");
      return;
    }
    if (!state.signer) {
      setStatus("Connect a wallet first.", "error");
      return;
    }
    try {
      const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, state.signer);
      const receipt = await runTx("Deploy vault", () => factory.createVault());
      const parsed = receipt.logs
        .map((log) => {
          try {
            return factory.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e) => e && e.name === "VaultCreated");
      if (parsed) {
        await loadVault(parsed.args.vault);
      }
    } catch {
      /* status already reported by runTx */
    }
  }

  // ---------------------------------------------------------------------
  // Owner action forms
  // ---------------------------------------------------------------------

  function bindFundEthForm() {
    $("fund-eth-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = $("fund-eth-amount").value.trim();
      let value;
      try {
        value = ethers.parseEther(raw || "0");
      } catch {
        setStatus("Enter a valid ETH amount.", "error");
        return;
      }
      if (value <= 0n) {
        setStatus("Enter a positive ETH amount.", "error");
        return;
      }
      try {
        await runTx("Deposit ETH", () => state.signer.sendTransaction({ to: state.vaultAddress, value }));
        await renderOverview();
        await renderActivity();
      } catch {
        /* status already reported */
      }
    });
  }

  function bindFundErc20Form() {
    $("fund-erc20-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const tokenAddress = $("fund-token-address").value.trim();
      const rawAmount = $("fund-token-amount").value.trim();
      if (!isValidAddress(tokenAddress)) {
        setStatus("Enter a valid token address.", "error");
        return;
      }
      try {
        const decimals = await getDecimals(tokenAddress);
        const amount = ethers.parseUnits(rawAmount || "0", decimals);
        if (amount <= 0n) {
          setStatus("Enter a positive amount.", "error");
          return;
        }
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, state.signer);
        await runTx("Approve token", () => token.approve(state.vaultAddress, amount));
        await runTx("Deposit token", () => state.vault.depositERC20(tokenAddress, amount));
        await renderOverview();
        await renderActivity();
      } catch (err) {
        if (!(err && err.code === "ACTION_REJECTED")) {
          setStatus(`Deposit failed: ${describeError(err)}`, "error");
        }
      }
    });
  }

  function bindWithdrawForm() {
    $("withdraw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const tokenRaw = $("withdraw-token").value.trim();
      const token = tokenRaw === "" ? ethers.ZeroAddress : tokenRaw;
      const to = $("withdraw-to").value.trim();
      const rawAmount = $("withdraw-amount").value.trim();

      if (!isValidAddress(token)) {
        setStatus("Enter a valid token address, or leave blank for native ETH.", "error");
        return;
      }
      if (!isValidAddress(to)) {
        setStatus("Enter a valid recipient address.", "error");
        return;
      }
      try {
        const decimals = await getDecimals(token);
        const amount = ethers.parseUnits(rawAmount || "0", decimals);
        if (amount <= 0n) {
          setStatus("Enter a positive amount.", "error");
          return;
        }
        await runTx("Withdraw", () => state.vault.withdraw(token, amount, to));
        await renderOverview();
        await renderActivity();
      } catch (err) {
        if (!(err && err.code === "ACTION_REJECTED")) {
          setStatus(`Withdraw failed: ${describeError(err)}`, "error");
        }
      }
    });
  }

  function parseAddressList(raw, fieldLabel) {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) {
      throw new Error(`Enter at least one address for ${fieldLabel}.`);
    }
    for (const p of parts) {
      if (!isValidAddress(p)) {
        throw new Error(`"${p}" in ${fieldLabel} is not a valid address.`);
      }
    }
    return parts;
  }

  function bindCreateSessionForm() {
    $("create-session-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const agent = form.agent.value.trim();
      const spendTokenRaw = form.spendToken.value.trim();
      const spendToken = spendTokenRaw === "" ? ethers.ZeroAddress : spendTokenRaw;

      if (!isValidAddress(agent)) {
        setStatus("Enter a valid agent address.", "error");
        return;
      }
      if (!isValidAddress(spendToken)) {
        setStatus("Enter a valid spend token address, or leave blank for native ETH.", "error");
        return;
      }

      try {
        const decimals = await getDecimals(spendToken);
        const maxPerTx = ethers.parseUnits(form.maxPerTx.value.trim() || "0", decimals);
        const maxPerPeriod = ethers.parseUnits(form.maxPerPeriod.value.trim() || "0", decimals);
        const periodHours = Number(form.periodHours.value);
        const expiryDays = Number(form.expiryDays.value);

        if (!(periodHours > 0) || !(expiryDays > 0)) {
          setStatus("Period length and expiry must be positive numbers.", "error");
          return;
        }
        if (maxPerTx <= 0n || maxPerPeriod <= 0n || maxPerTx > maxPerPeriod) {
          setStatus("Max per trade must be positive and no greater than max per period.", "error");
          return;
        }

        const periodDuration = Math.round(periodHours * 3600);
        const expiry = Math.floor(Date.now() / 1000) + Math.round(expiryDays * 86400);

        const outputTokens = parseAddressList(form.outputTokens.value, "allowed output tokens");
        const venues = parseAddressList(form.venues.value, "allowed venues");

        const receipt = await runTx("Create session", () =>
          state.vault.createSession(agent, spendToken, maxPerTx, maxPerPeriod, periodDuration, expiry, outputTokens, venues)
        );
        void receipt;
        form.reset();
        await renderSessions();
        await renderActivity();
      } catch (err) {
        if (!(err && err.code === "ACTION_REJECTED")) {
          setStatus(`Create session failed: ${describeError(err)}`, "error");
        }
      }
    });
  }

  function bindPauseButtons() {
    $("pause-btn").addEventListener("click", async () => {
      try {
        await runTx("Pause vault", () => state.vault.pause());
        await renderOverview();
      } catch {
        /* status already reported */
      }
    });
    $("unpause-btn").addEventListener("click", async () => {
      try {
        await runTx("Unpause vault", () => state.vault.unpause());
        await renderOverview();
      } catch {
        /* status already reported */
      }
    });
  }

  // ---------------------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------------------

  function init() {
    $("connect-btn").addEventListener("click", connectWallet);
    $("connect-btn-mobile").addEventListener("click", connectWallet);
    $("load-vault-btn").addEventListener("click", () => loadVault($("vault-address-input").value.trim()));
    $("list-vaults-btn").addEventListener("click", listMyVaults);
    $("create-vault-btn").addEventListener("click", createVaultFromFactory);

    bindFundEthForm();
    bindFundErc20Form();
    bindWithdrawForm();
    bindCreateSessionForm();
    bindPauseButtons();

    watchProviderEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
