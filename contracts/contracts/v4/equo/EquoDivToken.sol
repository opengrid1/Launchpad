// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EquoToken, IEquoTokenPending} from "./EquoToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IEquoDivTokenPending is IEquoTokenPending {
    function pendingDivWiring() external view returns (address pairAsset, address poolManager, address factory, address hook, address converter, address weth);
}

interface IEquoWrappedToken {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title EquoDivToken
/// @notice A EquoHook coin born with the dividends instinct. Exactly EquoToken
///         (a plain ERC-20 with permits: no owner, no mint, no tax, nothing
///         that can ever block a transfer) plus passive bookkeeping so holders
///         can claim their share of pool fees: the hook forwards the coin's
///         dividend share here in the pair asset and holders claim pro-rata
///         (as ETH for a WETH pair). The bookkeeping never charges, blocks or
///         slows a transfer; the pool, the launchpad's own contracts and this
///         contract hold no claimable shares.
///
///         A contract that holds the coin but never calls {claimDividends}
///         (say a third-party pool someone seeds) accrues its share like any
///         holder; what it never claims simply stays here unclaimed. Nothing
///         is taken from anyone else: every other holder's claim is unchanged.
contract EquoDivToken is EquoToken {
    using SafeERC20 for IERC20;

    uint256 internal constant MAG = 1 << 128;

    address public immutable pairAsset;
    address public immutable poolManager;
    address public immutable factory;
    address public immutable hook;
    address public immutable converter;
    address public immutable weth;
    /// @notice Dividends only distribute once this many shares exist, so the
    ///         per-share accumulator can never grow into overflow territory.
    uint256 public immutable minShares;

    /// @notice Supply held by claimable wallets (everything outside the pool and the launchpad's contracts).
    uint256 public totalShares;
    /// @notice Pair units distributed to holders so far.
    uint256 public totalDividends;
    uint256 private _magnifiedPerShare;
    mapping(address => int256) private _corrections;
    mapping(address => uint256) public withdrawnDividends;

    error InvalidParams();
    error NotHook();
    error NoShares();

    event DividendsDistributed(uint256 amount);
    event DividendsClaimed(address indexed holder, uint256 amount);

    constructor() EquoToken() {
        (pairAsset, poolManager, factory, hook, converter, weth) = IEquoDivTokenPending(msg.sender).pendingDivWiring();
        if (pairAsset == address(0) || hook == address(0) || weth == address(0)) revert InvalidParams();
        minShares = totalSupply() / 10_000;
    }

    /// @dev Dividends on a WETH pair are claimed as ETH; the unwrap lands here first.
    receive() external payable {}

    /// @notice Record `amount` of the pair asset (already transferred here by
    ///         the hook) as dividends for current holders. Hook only.
    function distribute(uint256 amount) external {
        if (msg.sender != hook) revert NotHook();
        if (amount == 0) revert InvalidParams();
        if (totalShares < minShares) revert NoShares();
        _magnifiedPerShare += (amount * MAG) / totalShares;
        totalDividends += amount;
        emit DividendsDistributed(amount);
    }

    /// @notice Pair units `a` can claim right now.
    function withdrawableDividends(address a) public view returns (uint256) {
        if (_noShares(a)) return 0;
        uint256 acc = uint256(int256(_magnifiedPerShare * balanceOf(a)) + _corrections[a]) / MAG;
        return acc - withdrawnDividends[a];
    }

    /// @notice Claim your dividend share: ETH for a WETH pair, otherwise the pair token.
    function claimDividends() external returns (uint256 amount) {
        amount = withdrawableDividends(msg.sender);
        if (amount == 0) return 0;
        withdrawnDividends[msg.sender] += amount;
        if (pairAsset == weth) {
            IEquoWrappedToken(weth).withdraw(amount);
            (bool ok,) = msg.sender.call{value: amount}("");
            if (!ok) {
                // a contract that refuses ETH gets WETH instead
                IEquoWrappedToken(weth).deposit{value: amount}();
                IERC20(weth).safeTransfer(msg.sender, amount);
            }
        } else {
            IERC20(pairAsset).safeTransfer(msg.sender, amount);
        }
        emit DividendsClaimed(msg.sender, amount);
    }

    /// @dev The pool, the launchpad's contracts and this contract hold no claimable shares.
    function _noShares(address a) private view returns (bool) {
        return a == address(0) || a == poolManager || a == address(this) || a == factory || a == hook || (a == converter && a != address(0));
    }

    /// @dev Keep every holder's already-accrued dividends unchanged as balances
    ///      move. Pure bookkeeping: no external calls, no revert path.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (value == 0) return;
        uint256 m = _magnifiedPerShare * value;
        if (!_noShares(from)) {
            _corrections[from] += int256(m);
            totalShares -= value;
        }
        if (!_noShares(to)) {
            _corrections[to] -= int256(m);
            totalShares += value;
        }
    }
}
