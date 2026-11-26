// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LiqioToken} from "./LiqioToken.sol";

interface ILiqioWrappedNative {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title LiqioDivToken
/// @notice A Liqio coin born with the holder-rewards instinct. Exactly LiqioToken (no owner, no mint, no tax,
///         nothing that can ever block a transfer) plus passive bookkeeping so holders can claim their share of
///         pool fees: the hook forwards the coin's reward share here in the pair asset and holders claim pro-rata
///         (as HYPE for a WHYPE pair). The bookkeeping never charges, blocks or slows a transfer; the pool, the
///         launchpad's own contracts and this contract hold no claimable shares.
///
///         A contract that holds the coin but never calls {claimDividends} accrues its share like any holder;
///         what it never claims simply stays here unclaimed. Every other holder's claim is unchanged.
contract LiqioDivToken is LiqioToken {
    using SafeERC20 for IERC20;

    uint256 internal constant MAG = 1 << 128;

    address public pairAsset;
    address public poolManager;
    address public factory;
    address public hook;
    address public converter;
    address public weth;
    /// @notice Rewards only distribute once this many shares exist, so the per-share accumulator can never
    ///         grow into overflow territory.
    uint256 public minShares;

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
    error WrongInit();

    event DividendsDistributed(uint256 amount);
    event DividendsClaimed(address indexed holder, uint256 amount);

    /// @dev A rewards coin is only ever set up through {initializeDiv}.
    function initialize(string calldata, string calldata, string calldata, uint256, address) external pure override {
        revert WrongInit();
    }

    function initializeDiv(
        string calldata name_,
        string calldata symbol_,
        string calldata uri,
        uint256 supply,
        address to,
        address pairAsset_,
        address poolManager_,
        address factory_,
        address hook_,
        address converter_,
        address weth_
    ) external initializer {
        if (msg.sender != deployer) revert NotDeployer();
        if (pairAsset_ == address(0) || hook_ == address(0) || weth_ == address(0) || factory_ == address(0)) revert InvalidParams();
        pairAsset = pairAsset_;
        poolManager = poolManager_;
        factory = factory_;
        hook = hook_;
        converter = converter_;
        weth = weth_;
        minShares = supply / 10_000;
        _init(name_, symbol_, uri, supply, to);
    }

    /// @dev Rewards on a WHYPE pair are claimed as HYPE; the unwrap lands here first.
    receive() external payable {}

    /// @notice Record `amount` of the pair asset (already transferred here by the hook) as rewards for current
    ///         holders. Hook only.
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

    /// @notice Claim your reward share: HYPE for a WHYPE pair, otherwise the pair token.
    function claimDividends() external returns (uint256 amount) {
        amount = withdrawableDividends(msg.sender);
        if (amount == 0) return 0;
        withdrawnDividends[msg.sender] += amount;
        if (pairAsset == weth) {
            ILiqioWrappedNative(weth).withdraw(amount);
            (bool ok,) = msg.sender.call{value: amount}("");
            if (!ok) {
                // a contract that refuses the native coin gets the wrapped one instead
                ILiqioWrappedNative(weth).deposit{value: amount}();
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

    /// @dev Keep every holder's already-accrued rewards unchanged as balances move. Pure bookkeeping: no
    ///      external calls, no revert path.
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
