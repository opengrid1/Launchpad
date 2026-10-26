// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";

interface IEquoCoinPending {
    function pendingCoin()
        external
        view
        returns (string memory name, string memory symbol, string memory metadataURI, uint256 slice, address creator);
    /// @dev LayerZero endpoint on this chain, the wiring owner (the coin deployer) and the bridge fee recipient.
    function pendingLz() external view returns (address endpoint, address owner, address bridgeFeeTo);
}

/// @title EquoCoin
/// @notice An Equo coin: an ERC-20 with 9 decimals and EIP-2612 permits that lives on several chains as one
///         LayerZero OFT. Each chain mints its own slice of the coin's 1B once, at construction, to the factory,
///         which puts it into that chain's pool. Bridging burns on the way out and mints on the way in (Solana
///         included), so the total across chains never changes; 0.2% of a bridged amount goes to the platform.
///         No further mint, no burn, no pause, no blacklist, no tax on transfers.
///
///         The coin deployer wires the coin's peers on its other chains at launch and gives up ownership in the
///         same call, so peers, options and delegate are sealed for good.
///
///         The creator holds the metadata pen (logo, description, links) and can hand it on in two steps.
///
/// @dev    Everything that differs per coin is read back from the deploying contract during construction, which
///         keeps the init code constant so a coin's address depends only on its salt.
contract EquoCoin is OFT, ERC20Permit {
    uint16 public constant BRIDGE_FEE_BPS = 20;

    /// @notice Receives the 0.2% bridge fee.
    address public immutable bridgeFeeTo;
    /// @notice What this chain minted at launch.
    uint256 public immutable launchSlice;
    /// @notice The coin's creator, recorded for good.
    address public immutable creator;

    string private _metadataURI;
    /// @notice May change {metadataURI}. Starts as the creator.
    address public metadataAuthority;
    address public pendingMetadataAuthority;

    event BridgeFee(address indexed from, uint256 amount);
    event MetadataURISet(string uri);
    event MetadataAuthorityOffered(address indexed to);
    event MetadataAuthorityTransferred(address indexed from, address indexed to);

    error NotMetadataAuthority();
    error NothingArrives();

    constructor()
        OFT(_name(), _symbol(), _endpoint(), _wiringOwner())
        ERC20Permit(_name())
        Ownable(_wiringOwner())
    {
        (,, string memory uri, uint256 slice, address creator_) = IEquoCoinPending(msg.sender).pendingCoin();
        (,, bridgeFeeTo) = IEquoCoinPending(msg.sender).pendingLz();
        _metadataURI = uri;
        launchSlice = slice;
        creator = creator_;
        metadataAuthority = creator_;
        _mint(_wiringOwner(), slice);
    }

    function decimals() public pure override returns (uint8) {
        return 9;
    }

    /// @notice This chain's launch slice: steady, so price times supply reads the same on every chain no matter how
    ///         many coins have bridged in or out. What is here right now is {localSupply}.
    function totalSupply() public view override returns (uint256) {
        return launchSlice;
    }

    /// @notice The coins on this chain right now: the sum of its balances.
    function localSupply() external view returns (uint256) {
        return super.totalSupply();
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    function setMetadataURI(string calldata uri) external {
        if (msg.sender != metadataAuthority) revert NotMetadataAuthority();
        _metadataURI = uri;
        emit MetadataURISet(uri);
    }

    /// @notice Offer the metadata pen to `to` (zero cancels); they take it with {acceptMetadataAuthority}.
    function offerMetadataAuthority(address to) external {
        if (msg.sender != metadataAuthority) revert NotMetadataAuthority();
        pendingMetadataAuthority = to;
        emit MetadataAuthorityOffered(to);
    }

    function acceptMetadataAuthority() external {
        if (msg.sender != pendingMetadataAuthority || msg.sender == address(0)) revert NotMetadataAuthority();
        emit MetadataAuthorityTransferred(metadataAuthority, msg.sender);
        metadataAuthority = msg.sender;
        pendingMetadataAuthority = address(0);
    }

    function _name() private view returns (string memory n) {
        (n,,,,) = IEquoCoinPending(msg.sender).pendingCoin();
    }

    function _symbol() private view returns (string memory s) {
        (, s,,,) = IEquoCoinPending(msg.sender).pendingCoin();
    }

    function _endpoint() private view returns (address e) {
        (e,,) = IEquoCoinPending(msg.sender).pendingLz();
    }

    function _wiringOwner() private view returns (address o) {
        (, o,) = IEquoCoinPending(msg.sender).pendingLz();
    }

    /// @dev Quote side of a bridge transfer: 0.2% of the amount stays behind as the bridge fee.
    function _debitView(uint256 amountLD, uint256 minAmountLD, uint32) internal view override returns (uint256 sent, uint256 received) {
        sent = _removeDust(amountLD);
        received = _removeDust(sent - (sent * BRIDGE_FEE_BPS) / 10_000);
        if (received == 0) revert NothingArrives();
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
