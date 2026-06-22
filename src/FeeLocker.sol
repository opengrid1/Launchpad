// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface INonfungiblePositionManager {
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function collect(CollectParams calldata params) external returns (uint256 amount0, uint256 amount1);
}

/// @title FeeLocker
/// @notice Holds the Hyperswap V3 LP position (NFT) for HYPEX/WHYPE permanently.
///         The ONLY action it can perform on the position is collect() — harvest the
///         accrued 1% pool fee and forward it to the buyback contract. There is no
///         function to transfer the NFT out, decrease liquidity, or withdraw the
///         underlying, so the liquidity is locked for good while its fees keep
///         flowing to holders. Anyone can trigger collect().
contract FeeLocker {
    INonfungiblePositionManager public immutable POS;
    address public feeRecipient; // the buyback contract
    address public owner;
    uint256 public tokenId; // the locked LP position
    bool public frozen; // once frozen, feeRecipient is immutable and owner is gone

    event PositionLocked(uint256 indexed tokenId);
    event Collected(uint256 amount0, uint256 amount1, address indexed to);
    event FeeRecipientSet(address indexed recipient);
    event Sealed();

    constructor(address pos, address recipient) {
        require(pos != address(0) && recipient != address(0), "zero");
        POS = INonfungiblePositionManager(pos);
        feeRecipient = recipient;
        owner = msg.sender;
    }

    /// @notice Accept the LP NFT. Receiving it locks it here permanently — there is
    ///         no path out of this contract for the position.
    function onERC721Received(address, address, uint256 id, bytes calldata) external returns (bytes4) {
        require(msg.sender == address(POS), "not position manager");
        tokenId = id;
        emit PositionLocked(id);
        return this.onERC721Received.selector;
    }

    /// @notice Harvest the accrued pool fee (HYPEX + WHYPE) to the buyback. Anyone may call.
    function collect() external returns (uint256 amount0, uint256 amount1) {
        require(tokenId != 0, "no position");
        (amount0, amount1) = POS.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: feeRecipient,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        emit Collected(amount0, amount1, feeRecipient);
    }

    /// @notice Set the buyback recipient (only before sealing). Lets the deployer wire
    ///         the buyback after deployment, then lock it.
    function setFeeRecipient(address recipient) external {
        require(msg.sender == owner && !frozen, "denied");
        require(recipient != address(0), "zero");
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// @notice Permanently freeze the configuration: feeRecipient can never change and
    ///         there is no owner anymore. collect() still works for anyone.
    function seal() external {
        require(msg.sender == owner, "not owner");
        frozen = true;
        owner = address(0);
        emit Sealed();
    }

    // Deliberately NO decreaseLiquidity, NO NFT transfer, NO withdraw: the liquidity
    // can never leave this contract.
}
