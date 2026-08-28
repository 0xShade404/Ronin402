// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRwaVenue} from "../interfaces/IRwaVenue.sol";

/// @notice Test-only venue that pulls `tokenIn` but under-delivers `tokenOut` while
/// still returning the full requested amount as `amountOut`. Exists to prove
/// RoninVault's post-trade balance check catches under-delivery independently of
/// whatever a venue claims in its return value.
contract MockFaultyVenue is IRwaVenue {
    using SafeERC20 for IERC20;

    function swap(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 minAmountOut,
        address to
    ) external payable override returns (uint256 amountOut) {
        if (tokenIn != address(0)) {
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }
        uint256 shortfall = minAmountOut / 2;
        if (shortfall > 0) {
            IERC20(tokenOut).safeTransfer(to, shortfall);
        }
        return minAmountOut;
    }
}
