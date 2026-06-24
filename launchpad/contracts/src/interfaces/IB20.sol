// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice The subset of the B20 token surface this launchpad uses. B20 is a
/// full ERC-20 superset (verified against base/base-std), plus role-gated
/// mint/burn and admin controls.
interface IB20 {
    // ERC-20
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function decimals() external view returns (uint8);

    // B20 mint/burn (role-gated; MINT_ROLE / BURN_ROLE)
    function mint(address to, uint256 amount) external;
    function batchMint(address[] calldata recipients, uint256[] calldata amounts) external;
    function burn(uint256 amount) external;

    // B20 admin / roles
    function grantRole(bytes32 role, address account) external;
    function renounceRole(bytes32 role, address account) external;
    function renounceLastAdmin() external;
    function updateSupplyCap(uint128 newCap) external;
}
