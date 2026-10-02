// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title InkypumpLedger
/// @notice The trading record behind the leaderboard. The pool hook reports
///         every swap in every Inkypump pool here, attributed to the wallet that
///         signed the transaction (or the wallet a router named in hook data),
///         so trades through this site, Uniswap, aggregators and bots all
///         count the same.
///
///         Per wallet and coin the ledger keeps an average-cost position built
///         only from that wallet's own buys. A sell realizes profit against
///         that basis; coins sold beyond what the wallet bought itself (for
///         example received by transfer) realize nothing. That closes the
///         "buy on one wallet, sell on a fresh one" route to a fake profit
///         without any transfer accounting in the coin.
///
///         Stats are kept per 3-day epoch: realized profit, fees paid and
///         volume, in the pair asset. Only WETH-paired coins feed the stats
///         so every number is in the same unit.
contract InkypumpLedger {
    uint256 public constant EPOCH = 3 days;

    address public immutable hook;
    address public immutable weth;
    uint256 public immutable genesis;

    struct Position {
        uint128 units; // coins this wallet bought and still holds, per the ledger
        uint128 basis; // what it paid for them, pair wei (fees included)
    }

    struct Stat {
        int128 pnl;
        uint128 fees;
        uint128 volume;
        uint64 trades;
    }

    mapping(address wallet => mapping(address token => Position)) public positions;
    mapping(uint256 epoch => mapping(address wallet => Stat)) public stats;
    mapping(address wallet => int256) public lifetimePnl;
    mapping(address wallet => uint256) public lifetimeFees;

    event Trade(
        address indexed wallet,
        address indexed token,
        uint256 indexed epoch,
        bool isBuy,
        uint256 coinAmount,
        uint256 pairAmount,
        uint256 fee,
        int256 realized
    );

    error NotHook();
    error ZeroAddress();

    constructor(address hook_, address weth_) {
        if (hook_ == address(0) || weth_ == address(0)) revert ZeroAddress();
        hook = hook_;
        weth = weth_;
        genesis = block.timestamp;
    }

    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - genesis) / EPOCH;
    }

    function epochEnd(uint256 epoch) external view returns (uint256) {
        return genesis + (epoch + 1) * EPOCH;
    }

    /// @notice Hook only. `pairAmount` is what the wallet paid (buy, fee
    ///         included) or received (sell, fee deducted) in the pair asset.
    function record(address wallet, address token, address pair, bool isBuy, uint256 coinAmount, uint256 pairAmount, uint256 fee) external {
        if (msg.sender != hook) revert NotHook();
        if (wallet == address(0) || coinAmount == 0) return;
        Position storage p = positions[wallet][token];
        int256 realized;
        if (isBuy) {
            p.units += uint128(coinAmount);
            p.basis += uint128(pairAmount);
        } else {
            uint256 units = p.units;
            uint256 counted = coinAmount < units ? coinAmount : units;
            if (counted > 0) {
                uint256 basisPart = (uint256(p.basis) * counted) / units;
                uint256 proceeds = (pairAmount * counted) / coinAmount;
                realized = int256(proceeds) - int256(basisPart);
                p.units = uint128(units - counted);
                p.basis -= uint128(basisPart);
            }
        }
        uint256 epoch = currentEpoch();
        if (pair == weth) {
            Stat storage s = stats[epoch][wallet];
            s.pnl += int128(realized);
            s.fees += uint128(fee);
            s.volume += uint128(pairAmount);
            s.trades += 1;
            lifetimePnl[wallet] += realized;
            lifetimeFees[wallet] += fee;
        }
        emit Trade(wallet, token, epoch, isBuy, coinAmount, pairAmount, fee, realized);
    }

    /// @notice Average cost per coin for `wallet` in `token`, pair wei per 1e18 coins; zero when nothing is held.
    function averageCost(address wallet, address token) external view returns (uint256) {
        Position memory p = positions[wallet][token];
        return p.units == 0 ? 0 : (uint256(p.basis) * 1e18) / p.units;
    }
}
