// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Testnet/demo USDC-like token implementing EIP-3009 `transferWithAuthorization`,
/// the exact gasless-payment primitive real x402 facilitators use against production USDC
/// on Base/Ethereum. This lets Ronin402's server and agent code run against realistic
/// payment mechanics locally without touching a real stablecoin.
/// @dev Anyone can mint — this is a faucet token for local/testnet use only. It must
/// never be treated as, or deployed alongside, anything holding real value.
contract MockUSDC is ERC20, EIP712 {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    constructor() ERC20("Mock USD Coin", "mUSDC") EIP712("Mock USD Coin", "1") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @dev Open faucet — testnet/demo only, see contract-level warning.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    /// @notice Moves `value` from `from` to `to` using a signed EIP-3009 authorization
    /// instead of the caller needing a prior `approve`. Anyone (typically an x402
    /// facilitator) may submit this on `from`'s behalf and pay the gas.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        require(block.timestamp > validAfter, "MockUSDC: authorization not yet valid");
        require(block.timestamp < validBefore, "MockUSDC: authorization expired");
        require(!_authorizationStates[from][nonce], "MockUSDC: authorization already used");

        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        require(signer == from, "MockUSDC: invalid signature");

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        _transfer(from, to, value);
    }
}
