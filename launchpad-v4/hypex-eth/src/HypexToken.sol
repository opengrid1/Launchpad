// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {IHypexToken} from "./interfaces/IHypexToken.sol";

/// @title HypexToken
/// @notice Plain ERC-20 (OpenZeppelin) with 1,000,000,000 (18 decimals) minted once on each chain it launches on, to the
///         deployer (the factory). No owner, no fees on transfer, no blacklist. Holders can burn their own tokens (the
///         floor treats burned tokens as gone). Nobody can burn or move anyone else's tokens. The only other mint is the
///         factory's bridge's (HypexBridge): coins leaving for another chain are burned there by their holder (sent to
///         the bridge with their approval, then burned), and minted here one for one, never past MAX_SUPPLY.
/// @dev The bridge is read from the factory at each call, so the init code (and the address, the same on every chain)
///      doesn't depend on it.
contract HypexToken is ERC20, ERC20Burnable, IHypexToken {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    /// @notice The most this chain can ever hold: every chain's launch supply together (Elysium and HyperEVM, 1B each).
    ///         Bridge mints only replace coins burned on the other chain, so they can never pass it.
    uint256 public constant MAX_SUPPLY = 2 * TOTAL_SUPPLY;
    /// @notice The factory that deployed it, which names the bridge
    address public immutable factory;

    error NotBridge();
    error OverMaxSupply();

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        factory = msg.sender;
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    function bridgeMint(address to, uint256 amount) external {
        _onlyBridge();
        if (totalSupply() + amount > MAX_SUPPLY) revert OverMaxSupply();
        _mint(to, amount);
    }

    function _onlyBridge() internal view {
        // a factory without a bridge (or a deployer that isn't a factory) has none: nothing passes
        (bool ok, bytes memory r) = factory.staticcall(abi.encodeWithSignature("bridge()"));
        if (!ok || r.length != 32 || msg.sender == address(0) || abi.decode(r, (address)) != msg.sender) {
            revert NotBridge();
        }
    }

    /// @dev OpenZeppelin's burn unchanged. Solidity requires this override because both ERC20Burnable and IHypexToken
    ///      declare burn.
    function burn(uint256 amount) public override(ERC20Burnable, IHypexToken) {
        super.burn(amount);
    }
}
