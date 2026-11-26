// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IPadFeeEscrow} from "./IPad.sol";

interface IPadStakingRewards {
    function notifyRewardAmount() external payable;
}

interface IPadAmmRouterLike {
    function WNATIVE() external view returns (address);
    function swapExactTokensForNative(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory);
}

interface IWNativeLike {
    function withdraw(uint256) external;
}

/**
 * @title PadSplitter
 * @notice The protocol's fee recipient. Every launch fee and every protocol share of the trading fees is credited
 * to this contract in the fee escrow (native HYPE), and the AMM pairs send their protocol fee here too; `distribute`
 * pulls the escrow and splits the native balance on the owner's shares: a stream to the stakers of the platform
 * token, a stream to the AMM's liquidity-mining farm, a buyback of the platform token that is burned, and the
 * treasury. The buyback leg is earmarked here and executed by the keeper with a minimum output, so a sandwich can
 * never pick its price. The owner can retune the shares, the destinations and the platform token, and can recover
 * any asset held here, so no value is ever stranded.
 */
contract PadSplitter is Ownable2Step, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error NotPoolManager();
    error NotKeeper();
    error SharesTooHigh();
    error NothingToDo();
    error TokenNotSet();
    error BadKey();
    error TooMuch(uint256 requested, uint256 available);
    error SlippageExceeded(uint256 got, uint256 minimum);
    error TransferFailed();
    error OwnershipCannotBeRenounced();

    event Distributed(uint256 toStaking, uint256 toBuyback, uint256 toTreasury);
    event DistributedToFarm(uint256 toFarm);
    event BoughtBackAndBurned(uint256 quoteIn, uint256 tokensBurned);
    event SharesSet(uint16 stakingBps, uint16 burnBps, uint16 farmBps);
    event FarmSet(address farm);
    event AmmRouterSet(address router);
    event Converted(address token, uint256 amountIn, uint256 nativeOut);
    event StakingSet(address staking);
    event TreasurySet(address treasury);
    event KeeperSet(address keeper);
    event TokenSet(address token, PoolKey key);
    event Recovered(address asset, address to, uint256 amount);

    uint256 private constant BASIS_POINTS = 10_000;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IPoolManager public immutable poolManager;
    IPadFeeEscrow public immutable feeEscrow;

    address public staking;
    address public farm;
    address public ammRouter;
    address public treasury;
    address public keeper;
    uint16 public stakingBps;
    uint16 public burnBps;
    uint16 public farmBps;
    /// @notice The platform token and its pool against native HYPE (currency0 = native).
    address public token;
    PoolKey public tokenKey;
    /// @notice HYPE earmarked for buybacks that the keeper has not executed yet.
    uint256 public pendingBuyback;

    constructor(address initialOwner, IPoolManager poolManager_, IPadFeeEscrow feeEscrow_, address treasury_, uint16 stakingBps_, uint16 burnBps_)
        Ownable(initialOwner)
    {
        if (address(poolManager_) == address(0) || address(feeEscrow_) == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (uint256(stakingBps_) + burnBps_ > BASIS_POINTS) revert SharesTooHigh();
        poolManager = poolManager_;
        feeEscrow = feeEscrow_;
        treasury = treasury_;
        stakingBps = stakingBps_;
        burnBps = burnBps_;
        keeper = initialOwner;
    }

    receive() external payable {}

    // ---- owner ------------------------------------------------------------------------------------------------

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    /// @notice The split: stakers, buyback and burn, farm; the treasury gets the rest.
    function setShares(uint16 stakingBps_, uint16 burnBps_, uint16 farmBps_) external onlyOwner {
        if (uint256(stakingBps_) + burnBps_ + farmBps_ > BASIS_POINTS) revert SharesTooHigh();
        stakingBps = stakingBps_;
        burnBps = burnBps_;
        farmBps = farmBps_;
        emit SharesSet(stakingBps_, burnBps_, farmBps_);
    }

    function setFarm(address farm_) external onlyOwner {
        farm = farm_;
        emit FarmSet(farm_);
    }

    /// @notice The AMM router `convert` sells ERC-20 fees through.
    function setAmmRouter(address router_) external onlyOwner {
        ammRouter = router_;
        emit AmmRouterSet(router_);
    }

    /// @notice Turns an ERC-20 the AMM pairs paid as protocol fee into native: wrapped native is unwrapped, anything
    ///         else is sold on its native pair with a minimum output. Keeper or owner.
    function convert(address tokenIn, uint256 amountIn, uint256 minNativeOut) external nonReentrant {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        if (ammRouter == address(0)) revert TokenNotSet();
        if (amountIn == 0) revert NothingToDo();
        address wnative = IPadAmmRouterLike(ammRouter).WNATIVE();
        uint256 before = address(this).balance;
        if (tokenIn == wnative) {
            IWNativeLike(wnative).withdraw(amountIn);
        } else {
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = wnative;
            IERC20(tokenIn).forceApprove(ammRouter, amountIn);
            IPadAmmRouterLike(ammRouter).swapExactTokensForNative(amountIn, minNativeOut, path, address(this), block.timestamp);
        }
        uint256 got = address(this).balance - before;
        if (got < minNativeOut) revert SlippageExceeded(got, minNativeOut);
        emit Converted(tokenIn, amountIn, got);
    }

    function setStaking(address staking_) external onlyOwner {
        staking = staking_;
        emit StakingSet(staking_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @notice The platform token and its pool. `key.currency0` must be native HYPE and `key.currency1` the token.
    function setToken(address token_, PoolKey calldata key) external onlyOwner {
        if (token_ == address(0)) revert ZeroAddress();
        if (Currency.unwrap(key.currency0) != address(0) || Currency.unwrap(key.currency1) != token_) revert BadKey();
        token = token_;
        tokenKey = key;
        emit TokenSet(token_, key);
    }

    /// @notice Sends `amount` of `asset` (address(0) = native HYPE) to `to`. Native taken out of the buyback earmark
    ///         shrinks the earmark, so the accounting never promises more than the balance.
    function recover(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (asset == address(0)) {
            uint256 bal = address(this).balance;
            if (amount > bal) revert TooMuch(amount, bal);
            if (pendingBuyback > bal - amount) pendingBuyback = bal - amount;
            (bool sent,) = payable(to).call{value: amount}("");
            if (!sent) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
        emit Recovered(asset, to, amount);
    }

    // ---- flow -------------------------------------------------------------------------------------------------

    /// @notice Pulls an ERC-20 the escrow holds for this contract (fees from pools paired with that token), so the
    /// keeper can convert it or the owner recover it. Anyone may call it.
    function pullToken(address token) external nonReentrant returns (uint256 amount) {
        if (token == address(0)) revert ZeroAddress();
        if (feeEscrow.balanceOfToken(address(this), token) == 0) revert NothingToDo();
        amount = feeEscrow.claimToken(token);
    }

    /// @notice Pulls what the escrow holds for this contract and splits the free balance. Anyone may call it.
    function distribute() external nonReentrant {
        if (feeEscrow.balanceOf(address(this)) != 0) feeEscrow.claim();
        uint256 free = address(this).balance - pendingBuyback;
        if (free == 0) revert NothingToDo();
        uint256 toStaking = staking == address(0) ? 0 : (free * stakingBps) / BASIS_POINTS;
        uint256 toFarm = farm == address(0) ? 0 : (free * farmBps) / BASIS_POINTS;
        uint256 toBuyback = token == address(0) ? 0 : (free * burnBps) / BASIS_POINTS;
        uint256 toTreasury = free - toStaking - toFarm - toBuyback;
        if (toStaking != 0) IPadStakingRewards(staking).notifyRewardAmount{value: toStaking}();
        if (toFarm != 0) IPadStakingRewards(farm).notifyRewardAmount{value: toFarm}();
        pendingBuyback += toBuyback;
        if (toTreasury != 0) {
            (bool sent,) = payable(treasury).call{value: toTreasury}("");
            if (!sent) revert TransferFailed();
        }
        emit Distributed(toStaking, toBuyback, toTreasury);
        if (toFarm != 0) emit DistributedToFarm(toFarm);
    }

    /// @notice Buys the platform token with `amount` of the earmarked HYPE and burns it. Keeper or owner only: the
    ///         minimum output is what protects the buyback from a sandwich, so it must come from a trusted caller.
    function buyback(uint256 amount, uint256 minTokensOut) external nonReentrant {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        if (token == address(0)) revert TokenNotSet();
        if (amount == 0 || minTokensOut == 0) revert NothingToDo();
        if (amount > pendingBuyback) revert TooMuch(amount, pendingBuyback);
        pendingBuyback -= amount;
        uint256 out = abi.decode(poolManager.unlock(abi.encode(amount)), (uint256));
        if (out < minTokensOut) revert SlippageExceeded(out, minTokensOut);
        IERC20(token).safeTransfer(DEAD, out);
        emit BoughtBackAndBurned(amount, out);
    }

    /// @dev One exact-input HYPE-for-token swap on the platform token's pool; the tokens land here.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        uint256 amountIn = abi.decode(data, (uint256));
        BalanceDelta delta = poolManager.swap(
            tokenKey,
            SwapParams({zeroForOne: true, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            ""
        );
        uint256 owed = uint256(uint128(-delta.amount0()));
        poolManager.settle{value: owed}();
        uint256 out = uint256(uint128(delta.amount1()));
        poolManager.take(tokenKey.currency1, address(this), out);
        return abi.encode(out);
    }
}
