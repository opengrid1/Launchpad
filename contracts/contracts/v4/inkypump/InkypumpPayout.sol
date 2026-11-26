// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWrappedNativeMin {
    function withdraw(uint256) external;
}

interface IInkypumpLedger {
    function currentEpoch() external view returns (uint256);
}

/// @title InkypumpPayout
/// @notice The leaderboard prize pool. WETH arrives here from the treasury
///         (its share of platform fees). After each 3-day epoch the admin
///         settles it: the top 5 of the PnL board and the top 5 of the volume
///         board, with amounts that follow the fixed tiers, computed from the
///         ledger's public stats. Winners claim in ETH whenever they like.
///
///         The admin can only settle a finished epoch once, only with the
///         pool's own balance, and only to ten wallets with tier-shaped
///         amounts; nothing here can send funds anywhere else.
contract InkypumpPayout is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 internal constant BPS = 10_000;
    uint256 public constant WINNERS_PER_BOARD = 5;
    /// @notice Share of each board's half of the pool, by rank.
    uint16[5] public TIERS = [4000, 2500, 1500, 1200, 800];

    address public immutable weth;
    address public immutable admin;
    IInkypumpLedger public immutable ledger;

    /// @notice ETH (as WETH) credited to winners and not yet claimed.
    uint256 public owed;
    mapping(address => uint256) public claimable;
    mapping(uint256 epoch => bool) public settled;
    mapping(uint256 epoch => uint256) public paidInEpoch;

    event Settled(uint256 indexed epoch, address[5] pnlWinners, address[5] volumeWinners, uint256 total);
    event Claimed(address indexed wallet, uint256 amount);

    error NotAdmin();
    error AlreadySettled();
    error EpochNotOver();
    error ZeroAddress();

    constructor(address weth_, address admin_, IInkypumpLedger ledger_) {
        if (weth_ == address(0) || admin_ == address(0) || address(ledger_) == address(0)) revert ZeroAddress();
        weth = weth_;
        admin = admin_;
        ledger = ledger_;
    }

    receive() external payable {}

    /// @notice WETH held here that is not yet promised to anyone.
    function available() public view returns (uint256) {
        uint256 bal = IERC20(weth).balanceOf(address(this));
        return bal > owed ? bal - owed : 0;
    }

    /// @notice Settle a finished epoch: the whole available pool, half per
    ///         board, tiered by rank. A zero address in a slot leaves that
    ///         tier unpaid (fewer than five qualifiers); it rolls over.
    function settle(uint256 epoch, address[5] calldata pnlWinners, address[5] calldata volumeWinners) external nonReentrant {
        if (msg.sender != admin) revert NotAdmin();
        if (settled[epoch]) revert AlreadySettled();
        if (epoch >= ledger.currentEpoch()) revert EpochNotOver();
        settled[epoch] = true;
        uint256 half = available() / 2;
        uint256 total;
        for (uint256 i; i < WINNERS_PER_BOARD; i++) {
            uint256 tier = (half * TIERS[i]) / BPS;
            if (pnlWinners[i] != address(0)) {
                claimable[pnlWinners[i]] += tier;
                total += tier;
            }
            if (volumeWinners[i] != address(0)) {
                claimable[volumeWinners[i]] += tier;
                total += tier;
            }
        }
        owed += total;
        paidInEpoch[epoch] = total;
        emit Settled(epoch, pnlWinners, volumeWinners, total);
    }

    /// @notice Take your winnings in ETH.
    function claim() external nonReentrant returns (uint256 amount) {
        amount = claimable[msg.sender];
        if (amount == 0) return 0;
        claimable[msg.sender] = 0;
        owed -= amount;
        IWrappedNativeMin(weth).withdraw(amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "eth xfer");
        emit Claimed(msg.sender, amount);
    }
}
