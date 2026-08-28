// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface every settlement venue allowlisted on a RoninVault session must implement.
/// @dev Using a fixed interface (instead of accepting arbitrary calldata from the agent) keeps
/// the vault's attack surface to "which contract" rather than "which function with which bytes",
/// which is what an allowlist can actually reason about.
interface IRwaVenue {
    /// @param tokenIn  address(0) means native ETH.
    /// @param tokenOut address(0) means native ETH.
    /// @param to       recipient of `tokenOut` — the vault always passes its own address.
    /// @return amountOut the amount of `tokenOut` actually delivered to `to`.
    function swap(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 minAmountOut,
        address to
    ) external payable returns (uint256 amountOut);
}
