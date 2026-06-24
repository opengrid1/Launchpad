// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice B20 token variants. Mirrors base-std's IB20Factory.
enum B20Variant {
    ASSET,
    STABLECOIN
}

/// @notice ABI-encoded creation params for the ASSET variant (verified against
/// base/base-std). Note: there is NO initial supply field — supply is minted
/// after creation via mint/batchMint (in the bootstrap initCalls or later).
struct B20AssetCreateParams {
    uint8 version;
    string name;
    string symbol;
    address initialAdmin;
    uint8 decimals;
}

/// @notice The singleton B20 factory precompile.
/// Reported mainnet address: 0xB20f0000000000000000000000000000000000000.
interface IB20Factory {
    function createB20(B20Variant variant, bytes32 salt, bytes calldata params, bytes[] calldata initCalls)
        external
        payable
        returns (address token);

    function getB20Address(B20Variant variant, address sender, bytes32 salt) external view returns (address);

    function isB20(address token) external view returns (bool);

    function isB20Initialized(address token) external view returns (bool);
}
