// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title AnypairLedger
/// @notice The trading record behind the leaderboard. The pool hook reports
///         every swap in every Anypair pool here, attributed to the wallet that
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
///         volume, converted to USD (8 decimals) at the pair's price from the
///         oracle, so coins on every pair rank on the same board. A pair
///         whose price can't be read keeps the position but adds nothing.
interface IPriceOracle {
    function poke(address token) external returns (uint256);
}

contract AnypairLedger {
    uint256 public constant EPOCH = 3 days;

    address public immutable hook;
    address public immutable weth;
    /// @notice Prices pairs in USD (AnypairOracle).
    address public immutable oracle;
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

    constructor(address hook_, address weth_, address oracle_) {
        if (hook_ == address(0) || weth_ == address(0) || oracle_ == address(0)) revert ZeroAddress();
        hook = hook_;
        weth = weth_;
        oracle = oracle_;
        genesis = block.timestamp;
    }

    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - genesis) / EPOCH;
    }

    function epochEnd(uint256 epoch) external view returns (uint256) {
        return genesis + (epoch + 1) * EPOCH;
    }

    /// @dev USD (18 dp) per 1e18 base units of the pair from the oracle
    ///      (which also steps a Uniswap V4 source's slow price); zero when unknown.
    function _pairUsd18(address pair) internal returns (uint256) {
        try IPriceOracle(oracle).poke(pair) returns (uint256 px) { return px; } catch { return 0; }
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
        uint256 px = _pairUsd18(pair);
        if (px != 0) {
            int256 pnlUsd = (realized * int256(px)) / 1e28;
            uint256 feeUsd = (fee * px) / 1e28;
            Stat storage s = stats[epoch][wallet];
            s.pnl += int128(pnlUsd);
            s.fees += uint128(feeUsd);
            s.volume += uint128((pairAmount * px) / 1e28);
            s.trades += 1;
            lifetimePnl[wallet] += pnlUsd;
            lifetimeFees[wallet] += feeUsd;
        }
        emit Trade(wallet, token, epoch, isBuy, coinAmount, pairAmount, fee, realized);
    }

    /// @notice Average cost per coin for `wallet` in `token`, pair wei per 1e18 coins; zero when nothing is held.
    function averageCost(address wallet, address token) external view returns (uint256) {
        Position memory p = positions[wallet][token];
        return p.units == 0 ? 0 : (uint256(p.basis) * 1e18) / p.units;
    }
}
