// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRwaVenue} from "../interfaces/IRwaVenue.sol";

interface IRoninVaultForReentrancy {
    function executeTrade(
        uint256 sessionId,
        address outputToken,
        uint256 spendAmount,
        uint256 minAmountOut,
        address venue,
        uint256 deadline
    ) external returns (uint256);
}

/// @notice Test-only venue that tries to re-enter RoninVault.executeTrade mid-swap.
/// Exists to prove the vault's ReentrancyGuard actually blocks it, not to model any
/// real settlement behavior.
contract MockReentrantVenue is IRwaVenue {
    using SafeERC20 for IERC20;

    address public vault;
    uint256 public sessionId;
    address public outputToken;
    uint256 public spendAmount;
    uint256 public minAmountOut;
    uint256 public deadline;

    function configure(
        address vault_,
        uint256 sessionId_,
        address outputToken_,
        uint256 spendAmount_,
        uint256 minAmountOut_,
        uint256 deadline_
    ) external {
        vault = vault_;
        sessionId = sessionId_;
        outputToken = outputToken_;
        spendAmount = spendAmount_;
        minAmountOut = minAmountOut_;
        deadline = deadline_;
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        address,
        uint256,
        address
    ) external payable override returns (uint256) {
        if (tokenIn != address(0)) {
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }
        IRoninVaultForReentrancy(vault).executeTrade(
            sessionId,
            outputToken,
            spendAmount,
            minAmountOut,
            address(this),
            deadline
        );
        return 0;
    }
}
