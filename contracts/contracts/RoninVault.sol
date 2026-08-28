// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRwaVenue} from "./interfaces/IRwaVenue.sol";

/// @title RoninVault
/// @notice Non-custodial escrow that lets the owner delegate bounded, revocable trading
/// authority to an AI agent's session key, without ever handing over withdrawal rights.
///
/// Trust model (read this before wiring up an agent):
///  - The vault OWNER is the only address that can deposit-configure sessions, pause,
///    revoke, or withdraw funds to an arbitrary address.
///  - An AGENT (a session's `agent` address) can only call `executeTrade` for its own
///    session, and only within that session's caps, output-token allowlist, venue
///    allowlist, and expiry. It can never withdraw funds to itself or anyone else.
///  - `minAmountOut` on every trade is caller-supplied and strictly enforced on-chain —
///    that is a hard guarantee. There is no on-chain price oracle, so a percentage
///    slippage bound is NOT enforced here; it is the agent/off-chain policy layer's job
///    to compute a safe `minAmountOut` from a trusted quote before calling in.
///  - Per-tx and rolling-period spending caps bound the blast radius of a compromised
///    or misbehaving agent key — they do not make an individual trade "safe" on their own.
contract RoninVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Session {
        address agent; // session key allowed to call executeTrade for this session
        address spendToken; // address(0) = native ETH; the single asset this session may spend
        uint256 maxPerTx; // cap on spendToken per single trade
        uint256 maxPerPeriod; // cap on cumulative spendToken within `periodDuration`
        uint64 periodDuration; // seconds; fixed-window reset (not a sliding window)
        uint64 expiry; // unix timestamp after which the session can no longer trade
        bool revoked;
        uint256 periodStart;
        uint256 spentInPeriod;
    }

    uint256 public nextSessionId;
    mapping(uint256 => Session) public sessions;
    mapping(uint256 => mapping(address => bool)) public allowedOutputToken;
    mapping(uint256 => mapping(address => bool)) public allowedVenue;

    event Deposited(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event SessionCreated(
        uint256 indexed sessionId,
        address indexed agent,
        address spendToken,
        uint256 maxPerTx,
        uint256 maxPerPeriod,
        uint64 periodDuration,
        uint64 expiry
    );
    event SessionRevoked(uint256 indexed sessionId);
    event TradeExecuted(
        uint256 indexed sessionId,
        address indexed agent,
        address spendToken,
        uint256 spendAmount,
        address outputToken,
        uint256 amountOut,
        address venue
    );

    constructor(address owner_) Ownable(owner_) {}

    receive() external payable {
        emit Deposited(address(0), msg.sender, msg.value);
    }

    // ---------------------------------------------------------------------
    // Owner: funding
    // ---------------------------------------------------------------------

    function depositERC20(address token, uint256 amount) external {
        require(token != address(0), "RoninVault: zero token");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(token, msg.sender, amount);
    }

    /// @notice Owner-only withdrawal. This is the ONLY path funds can leave the vault to an
    /// arbitrary address — agents never have access to it.
    function withdraw(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        require(to != address(0), "RoninVault: zero recipient");
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "RoninVault: ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit Withdrawn(token, to, amount);
    }

    // ---------------------------------------------------------------------
    // Owner: session policy
    // ---------------------------------------------------------------------

    function createSession(
        address agent,
        address spendToken,
        uint256 maxPerTx,
        uint256 maxPerPeriod,
        uint64 periodDuration,
        uint64 expiry,
        address[] calldata outputTokens,
        address[] calldata venues
    ) external onlyOwner returns (uint256 sessionId) {
        require(agent != address(0), "RoninVault: zero agent");
        require(periodDuration > 0, "RoninVault: zero period");
        require(expiry > block.timestamp, "RoninVault: expiry in past");
        require(maxPerTx > 0 && maxPerTx <= maxPerPeriod, "RoninVault: invalid caps");
        require(outputTokens.length > 0, "RoninVault: no output tokens");
        require(venues.length > 0, "RoninVault: no venues");

        sessionId = nextSessionId++;
        Session storage s = sessions[sessionId];
        s.agent = agent;
        s.spendToken = spendToken;
        s.maxPerTx = maxPerTx;
        s.maxPerPeriod = maxPerPeriod;
        s.periodDuration = periodDuration;
        s.expiry = expiry;
        s.periodStart = block.timestamp;

        for (uint256 i = 0; i < outputTokens.length; i++) {
            require(outputTokens[i] != address(0), "RoninVault: zero output token");
            require(outputTokens[i] != spendToken, "RoninVault: output equals spend token");
            allowedOutputToken[sessionId][outputTokens[i]] = true;
        }
        for (uint256 i = 0; i < venues.length; i++) {
            require(venues[i] != address(0), "RoninVault: zero venue");
            allowedVenue[sessionId][venues[i]] = true;
        }

        emit SessionCreated(sessionId, agent, spendToken, maxPerTx, maxPerPeriod, periodDuration, expiry);
    }

    function revokeSession(uint256 sessionId) external onlyOwner {
        Session storage s = sessions[sessionId];
        require(s.agent != address(0), "RoninVault: unknown session");
        require(!s.revoked, "RoninVault: already revoked");
        s.revoked = true;
        emit SessionRevoked(sessionId);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Agent: execution
    // ---------------------------------------------------------------------

    /// @notice Called by an agent's session key to settle a trade the agent has already
    /// sourced (quote + route) off-chain via x402. Every guard below is a hard on-chain
    /// check — none of it depends on the agent behaving honestly.
    function executeTrade(
        uint256 sessionId,
        address outputToken,
        uint256 spendAmount,
        uint256 minAmountOut,
        address venue,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        Session storage s = sessions[sessionId];
        require(msg.sender == s.agent, "RoninVault: not session agent");
        require(!s.revoked, "RoninVault: session revoked");
        require(block.timestamp <= s.expiry, "RoninVault: session expired");
        require(block.timestamp <= deadline, "RoninVault: trade expired");
        require(allowedVenue[sessionId][venue], "RoninVault: venue not allowed");
        require(allowedOutputToken[sessionId][outputToken], "RoninVault: output token not allowed");
        require(spendAmount > 0, "RoninVault: zero spend");
        require(minAmountOut > 0, "RoninVault: zero min out");
        require(spendAmount <= s.maxPerTx, "RoninVault: exceeds per-tx cap");

        _rollPeriodIfNeeded(s);
        require(s.spentInPeriod + spendAmount <= s.maxPerPeriod, "RoninVault: exceeds period cap");
        s.spentInPeriod += spendAmount;

        uint256 balBefore = _balanceOf(outputToken);

        if (s.spendToken == address(0)) {
            require(address(this).balance >= spendAmount, "RoninVault: insufficient ETH escrow");
            amountOut = IRwaVenue(venue).swap{value: spendAmount}(
                address(0),
                spendAmount,
                outputToken,
                minAmountOut,
                address(this)
            );
        } else {
            IERC20 spend = IERC20(s.spendToken);
            spend.safeIncreaseAllowance(venue, spendAmount);
            amountOut = IRwaVenue(venue).swap(s.spendToken, spendAmount, outputToken, minAmountOut, address(this));
            // Defensively zero out any allowance the venue didn't consume, so a venue
            // can never later pull more than what a single trade authorized.
            uint256 remaining = spend.allowance(address(this), venue);
            if (remaining > 0) spend.safeDecreaseAllowance(venue, remaining);
        }

        uint256 balAfter = _balanceOf(outputToken);
        // Reverts on underflow if the venue somehow reduced the vault's outputToken
        // balance, which also enforces the slippage/min-out guarantee.
        require(balAfter - balBefore >= minAmountOut, "RoninVault: slippage / insufficient output");
        require(amountOut >= minAmountOut, "RoninVault: venue underreported output");

        emit TradeExecuted(sessionId, msg.sender, s.spendToken, spendAmount, outputToken, amountOut, venue);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getSession(uint256 sessionId) external view returns (Session memory) {
        return sessions[sessionId];
    }

    function availablePeriodBudget(uint256 sessionId) external view returns (uint256) {
        Session storage s = sessions[sessionId];
        if (block.timestamp >= s.periodStart + s.periodDuration) {
            return s.maxPerPeriod;
        }
        if (s.spentInPeriod >= s.maxPerPeriod) return 0;
        return s.maxPerPeriod - s.spentInPeriod;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _rollPeriodIfNeeded(Session storage s) private {
        if (block.timestamp >= s.periodStart + s.periodDuration) {
            s.periodStart = block.timestamp;
            s.spentInPeriod = 0;
        }
    }

    function _balanceOf(address token) private view returns (uint256) {
        if (token == address(0)) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }
}
