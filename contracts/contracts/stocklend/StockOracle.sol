// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IStockOracle} from "./interfaces/IStockOracle.sol";

/// @title StockOracle
/// @notice Keeper-posted USD prices per RAW unit of each tokenized stock, with
///         staleness and per-update deviation guards. The keeper is expected to
///         post `marketPricePerShare * uiMultiplier` so the lending market can
///         stay in raw units through splits and dividends (see IStockOracle).
///
///         Guards:
///           - staleness: a price older than `maxAge` reverts on read, so a dead
///             keeper freezes borrows/liquidations instead of using a rotten price.
///           - deviation: a single update may move a price at most `maxDeviationBps`
///             from the last one. Real gaps (earnings, splits) are pushed through
///             `forcePrice` by the owner, which also documents them on-chain.
contract StockOracle is IStockOracle, Ownable {
    struct Price {
        uint192 pricePerRaw18;
        uint64 updatedAt;
    }

    mapping(address => Price) private _prices;
    mapping(address => bool) public isKeeper;

    uint256 public maxAge = 30 minutes;
    uint256 public maxDeviationBps = 2_000; // 20% per update

    event PriceUpdated(address indexed stock, uint256 pricePerRaw18, bool forced);
    event KeeperSet(address indexed keeper, bool allowed);
    event GuardsSet(uint256 maxAge, uint256 maxDeviationBps);

    error NotKeeper();
    error ZeroPrice();
    error Stale();
    error Deviation();

    modifier onlyKeeper() {
        if (!isKeeper[msg.sender]) revert NotKeeper();
        _;
    }

    constructor(address owner_) Ownable(owner_) {}

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function setGuards(uint256 maxAge_, uint256 maxDeviationBps_) external onlyOwner {
        require(maxAge_ > 0 && maxDeviationBps_ <= 10_000, "bad guards");
        maxAge = maxAge_;
        maxDeviationBps = maxDeviationBps_;
        emit GuardsSet(maxAge_, maxDeviationBps_);
    }

    /// @notice Keeper update, bounded by the deviation guard against the last price.
    function setPrice(address stock, uint256 pricePerRaw18) external onlyKeeper {
        if (pricePerRaw18 == 0) revert ZeroPrice();
        uint256 last = _prices[stock].pricePerRaw18;
        if (last != 0) {
            uint256 diff = pricePerRaw18 > last ? pricePerRaw18 - last : last - pricePerRaw18;
            if (diff * 10_000 > last * maxDeviationBps) revert Deviation();
        }
        _store(stock, pricePerRaw18, false);
    }

    /// @notice Owner override for legitimate large moves (earnings gaps, splits).
    function forcePrice(address stock, uint256 pricePerRaw18) external onlyOwner {
        if (pricePerRaw18 == 0) revert ZeroPrice();
        _store(stock, pricePerRaw18, true);
    }

    function setPrices(address[] calldata stocks, uint256[] calldata prices) external onlyKeeper {
        require(stocks.length == prices.length, "len");
        for (uint256 i; i < stocks.length; ++i) {
            uint256 p = prices[i];
            if (p == 0) revert ZeroPrice();
            uint256 last = _prices[stocks[i]].pricePerRaw18;
            if (last != 0) {
                uint256 diff = p > last ? p - last : last - p;
                if (diff * 10_000 > last * maxDeviationBps) revert Deviation();
            }
            _store(stocks[i], p, false);
        }
    }

    function _store(address stock, uint256 p, bool forced) private {
        _prices[stock] = Price({pricePerRaw18: uint192(p), updatedAt: uint64(block.timestamp)});
        emit PriceUpdated(stock, p, forced);
    }

    /// @inheritdoc IStockOracle
    function getPrice(address stock) external view override returns (uint256) {
        Price memory p = _prices[stock];
        if (p.pricePerRaw18 == 0 || block.timestamp - p.updatedAt > maxAge) revert Stale();
        return p.pricePerRaw18;
    }

    /// @notice Raw read without the staleness check (for UIs / monitoring).
    function peek(address stock) external view returns (uint256 pricePerRaw18, uint256 updatedAt) {
        Price memory p = _prices[stock];
        return (p.pricePerRaw18, p.updatedAt);
    }
}
