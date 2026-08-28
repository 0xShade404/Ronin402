// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RoninVault} from "./RoninVault.sol";

/// @title RoninVaultFactory
/// @notice Deploys one full RoninVault instance per call (not a minimal-proxy/clone
/// factory). That costs more gas per vault, but it sidesteps the entire class of
/// uninitialized-clone front-running bugs that clone+initializer factories are prone
/// to getting subtly wrong — a deliberate simplicity-over-gas tradeoff for a contract
/// that holds user funds.
contract RoninVaultFactory {
    mapping(address => address[]) public vaultsOf;

    event VaultCreated(address indexed owner, address indexed vault);

    function createVault() external returns (address vault) {
        vault = address(new RoninVault(msg.sender));
        vaultsOf[msg.sender].push(vault);
        emit VaultCreated(msg.sender, vault);
    }

    function vaultCountOf(address account) external view returns (uint256) {
        return vaultsOf[account].length;
    }
}
