// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {LoyaltyAirdrop} from "./LoyaltyAirdrop.sol";

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @title Treasury
/// @notice Holds the protocol's 10% fee slice (ETH) and spends ONLY that ETH.
///         It never touches any coin's liquidity. The owner (or a keeper) uses
///         it to buy a hyped token on Uniswap v4 and fund a loyalty airdrop to
///         the holders of an older coin — turning idle fees into engagement and
///         more volume, without harming anyone's position.
contract Treasury is IUnlockCallback {
    using CurrencyLibrary for Currency;

    IPoolManager public immutable manager;
    LoyaltyAirdrop public immutable airdrop;
    address public owner;

    struct Buy { PoolKey key; uint256 ethIn; }

    event OwnerChanged(address indexed owner);
    event BoughtAndFunded(address indexed token, uint256 ethIn, uint256 tokensOut, uint256 campaignId);

    error OnlyOwner();
    error OnlyManager();

    constructor(IPoolManager _manager, LoyaltyAirdrop _airdrop, address _owner) {
        manager = _manager;
        airdrop = _airdrop;
        owner = _owner;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    function setOwner(address o) external onlyOwner {
        owner = o;
        emit OwnerChanged(o);
    }

    /// Buy `ethIn` worth of the hyped token, then open a loyalty airdrop campaign
    /// distributing the bought tokens to a snapshot of an older coin's holders.
    /// @param key           the hyped token's v4 pool (ETH/token)
    /// @param ethIn         protocol ETH to spend (must be <= balance)
    /// @param merkleRoot    snapshot of eligible old-coin holders + amounts
    function buybackAndFund(PoolKey calldata key, uint256 ethIn, bytes32 merkleRoot)
        external
        onlyOwner
        returns (uint256 campaignId)
    {
        require(ethIn <= address(this).balance, "insufficient treasury");
        address token = Currency.unwrap(key.currency1);
        uint256 before = IERC20Min(token).balanceOf(address(this));

        manager.unlock(abi.encode(Buy(key, ethIn)));

        uint256 tokensOut = IERC20Min(token).balanceOf(address(this)) - before;
        // move the bought tokens into the airdrop escrow and open the campaign.
        IERC20Min(token).transfer(address(airdrop), tokensOut);
        campaignId = airdrop.createCampaign(token, merkleRoot, tokensOut);

        emit BoughtAndFunded(token, ethIn, tokensOut, campaignId);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert OnlyManager();
        Buy memory b = abi.decode(data, (Buy));

        BalanceDelta d = manager.swap(
            b.key,
            IPoolManager.SwapParams({
                zeroForOne: true,                    // ETH (currency0) -> token (currency1)
                amountSpecified: -int256(b.ethIn),   // exact ETH in
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        // pay the ETH we owe, collect the token we bought.
        manager.sync(b.key.currency0);
        manager.settle{value: uint256(int256(-d.amount0()))}();
        manager.take(b.key.currency1, address(this), uint256(int256(d.amount1())));
        return "";
    }

    receive() external payable {}
}
