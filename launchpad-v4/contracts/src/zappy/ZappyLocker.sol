// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PositionInfo, PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

/**
 * @title ZappyLocker
 * @notice Holds the three Uniswap V4 position NFTs of every Zappy launch, as
 * LiquidFiLocker does (same lockPositions / positionsOf / collect), and lends
 * part of a coin's own locked pair (ETH, or a stock token) to the margin
 * contract for leveraged longs on that coin.
 *
 * Only pair a band no longer needs to quote around the current price is lent:
 * a band the price has passed holds only the pair (what buyers paid), sitting
 * behind the price as support for sells. At most lendCapBps of it, per coin,
 * is out on loan at any time. Repayments, with the borrow fees and
 * liquidation penalties the margin contract adds, go back into the band
 * closest to the price that holds only the pair; while no band does, they
 * wait here as the coin's idle pair and anyone can restake them later. A loan
 * a liquidation cannot cover in full is a loss to that coin's pool.
 *
 * The margin contract is set once and can never be changed.
 * @dev The pair is always currency0 (the factory clones every coin above it),
 * native ETH or an ERC-20; an ERC-20 goes back into a band through Permit2.
 * Positions accrue no LP fees, so a decrease returns principal only.
 */
contract ZappyLocker is Ownable2Step, ReentrancyGuard {
    using StateLibrary for IPoolManager;
    using PositionInfoLibrary for PositionInfo;

    error NotFactory();
    error NotMargin();
    error AlreadyInitialized();
    error ZeroAddress();
    error PositionAlreadyLocked();
    error PositionNotHeld();
    error NotPositionManager();
    error UnknownToken();
    error InvalidParams();
    error NotEnoughToLend(uint256 available, uint256 wanted);
    error TransferFailed();
    error OwnershipCannotBeRenounced();

    event FactorySet(address factory);
    event MarginSet(address margin);
    event PositionsLocked(address indexed token, uint256[3] tokenIds);
    event Collected(address indexed token, uint16 bps, uint256 tokenAmount, uint256 pairAmount, address indexed recipient);
    event Lent(address indexed token, uint256 amount, uint256 outstanding);
    event Repaid(address indexed token, uint256 amount, uint256 principal, uint256 outstanding);
    event Restaked(address indexed token, uint256 tokenId, uint256 amount);
    event LendCapUpdated(uint256 bps);

    uint256 private constant BASIS_POINTS = 10_000;
    uint256 private constant MAX_LEND_CAP_BPS = 5_000;
    uint256 private constant MIN_RESTAKE = 1e12;

    IPositionManager public immutable positionManager;
    IPoolManager public immutable poolManager;
    IAllowanceTransfer public immutable permit2;
    address public factory;
    address public margin;
    uint256 public lendCapBps = 2_000; // at most 20% of a coin's passed-band pair out on loan

    mapping(address token => uint256[3] tokenIds) private _positions;
    mapping(address token => bool locked) public isLocked;
    mapping(address token => uint256) public lent; // principal out on loan
    mapping(address token => uint256) public idle; // the coin's pair held here, waiting to go back into a band

    constructor(address initialOwner, IPositionManager positionManager_, IAllowanceTransfer permit2_) Ownable(initialOwner) {
        if (address(positionManager_) == address(0) || address(permit2_) == address(0)) revert ZeroAddress();
        positionManager = positionManager_;
        poolManager = positionManager_.poolManager();
        permit2 = permit2_;
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    modifier onlyMargin() {
        if (msg.sender != margin) revert NotMargin();
        _;
    }

    receive() external payable {
        if (msg.sender != address(positionManager) && msg.sender != address(poolManager)) revert TransferFailed();
    }

    // ------------------------------------------------------------------ wiring

    function setFactory(address factory_) external onlyOwner {
        if (factory != address(0)) revert AlreadyInitialized();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function setMargin(address margin_) external onlyOwner {
        if (margin != address(0)) revert AlreadyInitialized();
        if (margin_ == address(0)) revert ZeroAddress();
        margin = margin_;
        emit MarginSet(margin_);
    }

    function setLendCap(uint256 bps) external onlyOwner {
        if (bps > MAX_LEND_CAP_BPS) revert InvalidParams();
        lendCapBps = bps;
        emit LendCapUpdated(bps);
    }

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(positionManager)) revert NotPositionManager();
        return this.onERC721Received.selector;
    }

    function lockPositions(address token, uint256[3] calldata tokenIds) external onlyFactory {
        if (isLocked[token]) revert PositionAlreadyLocked();
        for (uint256 i; i < 3; ++i) {
            if (IERC721(address(positionManager)).ownerOf(tokenIds[i]) != address(this)) revert PositionNotHeld();
        }
        isLocked[token] = true;
        _positions[token] = tokenIds;
        emit PositionsLocked(token, tokenIds);
    }

    function positionsOf(address token) external view returns (uint256[3] memory) {
        return _positions[token];
    }

    // ------------------------------------------------------------------ views

    /// @notice Pair in the bands the price has passed (they hold only the pair), plus the coin's idle pair.
    function passedPair(address token) public view returns (uint256 eth) {
        (, int24 tick) = _price(token);
        uint256[3] memory ids = _positions[token];
        for (uint256 i; i < 3; ++i) {
            (, PositionInfo info) = positionManager.getPoolAndPositionInfo(ids[i]);
            if (info.tickLower() <= tick) continue;
            eth += SqrtPriceMath.getAmount0Delta(
                TickMath.getSqrtPriceAtTick(info.tickLower()),
                TickMath.getSqrtPriceAtTick(info.tickUpper()),
                positionManager.getPositionLiquidity(ids[i]),
                false
            );
        }
        eth += idle[token];
    }

    /// @notice What the margin contract can borrow against `token` right now.
    function lendable(address token) public view returns (uint256) {
        if (!isLocked[token]) return 0;
        uint256 have = passedPair(token);
        uint256 cap = ((have + lent[token]) * lendCapBps) / BASIS_POINTS;
        if (cap <= lent[token]) return 0;
        return Math.min(cap - lent[token], have);
    }

    // ------------------------------------------------------------------ margin

    /// @notice Sends `amount` of `token`'s passed-band pair to the margin contract.
    function lend(address token, uint256 amount) external onlyMargin nonReentrant {
        uint256 room = lendable(token);
        if (amount == 0 || amount > room) revert NotEnoughToLend(room, amount);
        uint256 fromIdle = Math.min(idle[token], amount);
        idle[token] -= fromIdle;
        uint256 need = amount - fromIdle;
        if (need != 0) {
            uint256 got = _withdrawPassed(token, need);
            if (got < need) revert NotEnoughToLend(got + fromIdle, amount);
            idle[token] += got - need; // rounding dust stays with the coin
        }
        lent[token] += amount;
        (PoolKey memory key,) = _price(token);
        key.currency0.transfer(margin, amount);
        emit Lent(token, amount, lent[token]);
    }

    /**
     * @notice Takes back `amount` of the pair for a loan of `principal` and
     * puts it in the band closest to the price that holds only the pair. ETH
     * comes with the call; an ERC-20 pair is transferred here by the margin
     * contract just before. Less than the principal is a loss to the coin's
     * pool; more (fees, penalties) adds to it.
     */
    function repay(address token, uint256 principal, uint256 amount) external payable onlyMargin nonReentrant {
        (PoolKey memory key,) = _price(token);
        if (msg.value != (key.currency0.isAddressZero() ? amount : 0)) revert InvalidParams();
        lent[token] -= Math.min(lent[token], principal);
        idle[token] += amount;
        emit Repaid(token, amount, principal, lent[token]);
        _restake(token);
    }

    /// @notice Anyone can put a coin's idle ETH back into its pool once a band holds only ETH again.
    function restake(address token) external nonReentrant {
        if (!isLocked[token]) revert UnknownToken();
        _restake(token);
    }

    // ------------------------------------------------------------------ owner

    /**
     * @notice Owner only. Removes `bps` of the liquidity of each of `token`'s
     * positions, and the same share of its idle pair, and sends both sides to
     * `recipient`.
     */
    function collect(address token, uint16 bps, address recipient)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokenAmount, uint256 pairAmount)
    {
        if (bps == 0 || bps > BASIS_POINTS || recipient == address(0)) revert InvalidParams();
        if (!isLocked[token]) revert UnknownToken();
        uint256[3] memory ids = _positions[token];
        (PoolKey memory key,) = positionManager.getPoolAndPositionInfo(ids[0]);

        bytes memory actions;
        bytes[] memory params = new bytes[](4);
        uint256 n;
        for (uint256 i; i < 3; ++i) {
            uint256 removed = (uint256(positionManager.getPositionLiquidity(ids[i])) * bps) / BASIS_POINTS;
            if (removed == 0) continue;
            actions = abi.encodePacked(actions, uint8(Actions.DECREASE_LIQUIDITY));
            params[n++] = abi.encode(ids[i], removed, uint128(0), uint128(0), bytes(""));
        }
        if (n == 0) revert InvalidParams();
        actions = abi.encodePacked(actions, uint8(Actions.TAKE_PAIR));
        params[n++] = abi.encode(key.currency0, key.currency1, recipient);
        assembly {
            mstore(params, n)
        }
        uint256 tokenBefore = key.currency1.balanceOf(recipient);
        uint256 pairBefore = key.currency0.balanceOf(recipient);
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
        tokenAmount = key.currency1.balanceOf(recipient) - tokenBefore;
        pairAmount = key.currency0.balanceOf(recipient) - pairBefore;

        uint256 fromIdle = (idle[token] * bps) / BASIS_POINTS;
        if (fromIdle != 0) {
            idle[token] -= fromIdle;
            pairAmount += fromIdle;
            key.currency0.transfer(recipient, fromIdle);
        }
        emit Collected(token, bps, tokenAmount, pairAmount, recipient);
    }

    // --------------------------------------------------------------- internal

    function _price(address token) private view returns (PoolKey memory key, int24 tick) {
        if (!isLocked[token]) revert UnknownToken();
        (key,) = positionManager.getPoolAndPositionInfo(_positions[token][0]);
        (, tick,,) = poolManager.getSlot0(key.toId());
    }

    /// @dev Passed (ETH-only) bands, nearest to the price first.
    function _passedOrder(address token, int24 tick) private view returns (uint256[3] memory order, uint256 count, PositionInfo[3] memory infos) {
        uint256[3] memory ids = _positions[token];
        for (uint256 i; i < 3; ++i) (, infos[i]) = positionManager.getPoolAndPositionInfo(ids[i]);
        for (uint256 i; i < 3; ++i) {
            if (infos[i].tickLower() <= tick) continue;
            uint256 j = count++;
            order[j] = i;
            while (j > 0 && infos[order[j]].tickLower() < infos[order[j - 1]].tickLower()) {
                (order[j], order[j - 1]) = (order[j - 1], order[j]);
                --j;
            }
        }
    }

    function _withdrawPassed(address token, uint256 need) private returns (uint256 got) {
        (PoolKey memory key, int24 tick) = _price(token);
        uint256[3] memory ids = _positions[token];
        (uint256[3] memory order, uint256 count, PositionInfo[3] memory infos) = _passedOrder(token, tick);
        bytes memory actions;
        bytes[] memory params = new bytes[](4);
        uint256 n;
        uint256 left = need;
        for (uint256 k; k < count && left != 0; ++k) {
            uint256 i = order[k];
            uint160 lo = TickMath.getSqrtPriceAtTick(infos[i].tickLower());
            uint160 hi = TickMath.getSqrtPriceAtTick(infos[i].tickUpper());
            uint128 have = positionManager.getPositionLiquidity(ids[i]);
            uint256 inBand = SqrtPriceMath.getAmount0Delta(lo, hi, have, false);
            uint256 take = Math.min(left, inBand);
            // a hair over what is needed so rounding never leaves the loan short; the dust stays as idle ETH
            uint256 want = take == inBand ? inBand : Math.min(inBand, take + take / 1e4 + 1e3);
            uint128 liq = want == inBand ? have : uint128(Math.min(uint256(have), uint256(LiquidityAmounts.getLiquidityForAmount0(lo, hi, want)) + 1));
            if (liq == 0) continue;
            actions = abi.encodePacked(actions, uint8(Actions.DECREASE_LIQUIDITY));
            params[n++] = abi.encode(ids[i], uint256(liq), uint128(0), uint128(0), bytes(""));
            left -= take;
        }
        if (n == 0) return 0;
        actions = abi.encodePacked(actions, uint8(Actions.TAKE_PAIR));
        params[n++] = abi.encode(key.currency0, key.currency1, address(this));
        assembly {
            mstore(params, n)
        }
        uint256 before = key.currency0.balanceOfSelf();
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
        got = key.currency0.balanceOfSelf() - before;
    }

    function _restake(address token) private {
        uint256 amount = idle[token];
        if (amount < MIN_RESTAKE) return;
        (PoolKey memory key, int24 tick) = _price(token);
        (uint256[3] memory order, uint256 count, PositionInfo[3] memory infos) = _passedOrder(token, tick);
        if (count == 0) return; // no band holds only the pair: wait as idle
        uint256 i = order[0];
        uint256 id = _positions[token][i];
        uint160 lo = TickMath.getSqrtPriceAtTick(infos[i].tickLower());
        uint160 hi = TickMath.getSqrtPriceAtTick(infos[i].tickUpper());
        uint128 liq = LiquidityAmounts.getLiquidityForAmount0(lo, hi, amount);
        if (liq == 0) return;
        bool native = key.currency0.isAddressZero();
        bytes memory actions = native
            ? abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP))
            : abi.encodePacked(uint8(Actions.INCREASE_LIQUIDITY), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](native ? 3 : 2);
        params[0] = abi.encode(id, uint256(liq), uint128(amount), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        if (native) params[2] = abi.encode(key.currency0, address(this));
        else _approvePair(Currency.unwrap(key.currency0));
        uint256 before = key.currency0.balanceOfSelf();
        positionManager.modifyLiquidities{value: native ? amount : 0}(abi.encode(actions, params), block.timestamp);
        uint256 used = before - key.currency0.balanceOfSelf();
        idle[token] -= used;
        emit Restaked(token, id, used);
    }

    /// @dev The position manager settles an ERC-20 pair through Permit2: approve both once per pair.
    function _approvePair(address pair) private {
        if (IERC20(pair).allowance(address(this), address(permit2)) < type(uint128).max) IERC20(pair).approve(address(permit2), type(uint256).max);
        (uint160 amt, uint48 exp,) = permit2.allowance(address(this), pair, address(positionManager));
        if (amt < type(uint128).max || exp < block.timestamp + 365 days) {
            permit2.approve(pair, address(positionManager), type(uint160).max, type(uint48).max);
        }
    }
}
