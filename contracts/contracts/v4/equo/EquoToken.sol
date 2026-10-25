// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";

interface IEquoTokenPending {
    function pendingName() external view returns (string memory);
    function pendingSymbol() external view returns (string memory);
    function pendingMetadataURI() external view returns (string memory);
    function pendingSupply() external view returns (uint256);
    /// @dev LayerZero endpoint on this chain, the wiring owner (the token deployer) and the bridge fee recipient.
    function pendingLz() external view returns (address endpoint, address owner, address bridgeFeeTo);
}

/// @title EquoToken
/// @notice An Equo coin: an ERC-20 with EIP-2612 permits that also lives on other chains as a LayerZero OFT.
///         On each chain the coin has its own contract and its own launch supply (1B, or 1B / N when the coin's
///         1B is split across N chains), minted once at construction to
///         the factory, which puts it into that chain's Uniswap v4 pool. Bridging burns on the source chain and
///         mints on the destination, so the total across chains never changes. 0.2% of a bridged amount goes to
///         the platform. No mint beyond the launch supply, no pause, no blacklist, no tax on transfers.
///
///         The owner is the Equo token deployer contract. It wires the coin's peers on the other chains at launch
///         and can later add a peer for a chain that has none; it has no function that changes an existing peer,
///         the verifier setup or anything else. Every instinct the coin was born with lives in its pool hook.
///
/// @dev    Name, symbol, metadata, supply and LayerZero settings are read back from the deploying contract during
///         construction, which keeps the init code constant so every coin's address is predictable with CREATE2.
contract EquoToken is OFT, ERC20Permit {
    uint16 public constant BRIDGE_FEE_BPS = 20;

    string private _metadataURI;
    /// @notice Receives the 0.2% bridge fee.
    address public immutable bridgeFeeTo;
    /// @notice What this chain minted at launch: 1B, or 1B / N for a coin whose supply is split across N chains.
    uint256 public immutable launchSlice;
    /// @notice Coins burned on this chain with {burn} (the hook's buyback burns). Bridge transfers are not counted.
    uint256 public burned;

    event BridgeFee(address indexed from, uint256 amount);

    constructor()
        OFT(IEquoTokenPending(msg.sender).pendingName(), IEquoTokenPending(msg.sender).pendingSymbol(), _endpoint(), _wiringOwner())
        ERC20Permit(IEquoTokenPending(msg.sender).pendingName())
        Ownable(_wiringOwner())
    {
        (,, bridgeFeeTo) = IEquoTokenPending(msg.sender).pendingLz();
        _metadataURI = IEquoTokenPending(msg.sender).pendingMetadataURI();
        launchSlice = IEquoTokenPending(msg.sender).pendingSupply();
        _mint(_wiringOwner(), launchSlice);
    }

    /// @notice The supply trackers and explorers read: this chain's launch slice, less what was burned here.
    /// @dev Not the sum of the balances on this chain, which moves every time coins bridge in or out: price times
    ///      that figure would give every chain a different, drifting market cap at one price. Reporting the launch
    ///      slice keeps each chain's figure steady (1B per chain, or 1B / N in split mode), while real burns still
    ///      show. What is actually on this chain right now is {localSupply}.
    function totalSupply() public view override returns (uint256) {
        return launchSlice - burned;
    }

    /// @notice The coins on this chain right now: the sum of its balances. Moves as coins bridge in and out.
    function localSupply() external view returns (uint256) {
        return super.totalSupply();
    }

    function _endpoint() private view returns (address e) {
        (e,,) = IEquoTokenPending(msg.sender).pendingLz();
    }

    function _wiringOwner() private view returns (address o) {
        (, o,) = IEquoTokenPending(msg.sender).pendingLz();
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Burn coins you hold. The hook burns buyback coins this way.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        burned += amount;
    }

    /// @dev Quote side of a bridge transfer: 0.2% of the amount stays behind as the bridge fee.
    function _debitView(uint256 amountLD, uint256 minAmountLD, uint32) internal view override returns (uint256 sent, uint256 received) {
        sent = _removeDust(amountLD);
        received = _removeDust(sent - (sent * BRIDGE_FEE_BPS) / 10_000);
        if (received < minAmountLD) revert SlippageExceeded(received, minAmountLD);
    }

    /// @dev The fee moves to the platform; only what arrives on the other chain is burned here.
    function _debit(address from, uint256 amountLD, uint256 minAmountLD, uint32 dstEid) internal override returns (uint256 sent, uint256 received) {
        (sent, received) = _debitView(amountLD, minAmountLD, dstEid);
        uint256 fee = sent - received;
        if (fee > 0) {
            _transfer(from, bridgeFeeTo, fee);
            emit BridgeFee(from, fee);
        }
        _burn(from, received);
    }
}
