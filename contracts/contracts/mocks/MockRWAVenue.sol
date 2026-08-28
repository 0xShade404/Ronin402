// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRwaVenue} from "../interfaces/IRwaVenue.sol";

/// @notice Minimal fixed-rate swap venue for local/testnet exercising of RoninVault
/// settlement. This is NOT a market maker or price oracle — rates are set directly by
/// its operator and the venue must be pre-funded with `tokenOut` liquidity by that
/// same operator. Use only behind a vault session's venue allowlist in tests/demos.
contract MockRWAVenue is IRwaVenue {
    using SafeERC20 for IERC20;

    address public immutable operator;

    struct Rate {
        uint256 numerator;
        uint256 denominator;
    }

    // amountOut = amountIn * rate.numerator / rate.denominator
    mapping(address => mapping(address => Rate)) public rates;

    event RateSet(address indexed tokenIn, address indexed tokenOut, uint256 numerator, uint256 denominator);

    constructor(address operator_) {
        require(operator_ != address(0), "MockRWAVenue: zero operator");
        operator = operator_;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "MockRWAVenue: not operator");
        _;
    }

    function setRate(address tokenIn, address tokenOut, uint256 numerator, uint256 denominator) external onlyOperator {
        require(denominator > 0, "MockRWAVenue: zero denominator");
        rates[tokenIn][tokenOut] = Rate(numerator, denominator);
        emit RateSet(tokenIn, tokenOut, numerator, denominator);
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 minAmountOut,
        address to
    ) external payable override returns (uint256 amountOut) {
        Rate memory r = rates[tokenIn][tokenOut];
        require(r.denominator > 0, "MockRWAVenue: rate not set");
        require(to != address(0), "MockRWAVenue: zero recipient");

        if (tokenIn == address(0)) {
            require(msg.value == amountIn, "MockRWAVenue: bad ETH amount");
        } else {
            require(msg.value == 0, "MockRWAVenue: unexpected ETH");
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }

        amountOut = (amountIn * r.numerator) / r.denominator;
        require(amountOut >= minAmountOut, "MockRWAVenue: slippage");

        if (tokenOut == address(0)) {
            (bool ok, ) = to.call{value: amountOut}("");
            require(ok, "MockRWAVenue: ETH send failed");
        } else {
            IERC20(tokenOut).safeTransfer(to, amountOut);
        }
    }

    receive() external payable {}
}
