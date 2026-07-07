// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IUsdOracle {
    /// @return price of 1 whole unit of the asset in USD, 8 decimals (Chainlink-style).
    function usd1e8() external view returns (uint256);
}

/// @title StockRegistry
/// @notice The allowlist of *quote* currencies a coin may pair against.
///
///         Native ETH is always allowed. Every other quote (a tokenized stock)
///         must be listed here with a USD price oracle, so the factory can derive
///         a launch price from the creator's chosen starting market cap.
///
///         Governance here is deliberately minimal and *funds-safe*: the owner
///         can ADD a stock (and swap in a better oracle for one it already
///         listed) and can pause *new* listings, but there is NO function that
///         removes a listed stock, moves anyone's tokens, or touches fees/LP.
///         So the gatekeeping stops fake/scam "stocks" from being paired without
///         ever giving governance power over user funds. Ownership can be
///         renounced once the desired set of stocks is listed.
contract StockRegistry {
    struct Quote {
        bool listed;
        address oracle; // IUsdOracle for this stock's USD price
        uint8 decimals; // token decimals (for price math)
        string symbol; // e.g. "AAPLx"
    }

    address public owner;
    bool public listingFrozen; // once true, no new stocks can ever be added

    mapping(address => Quote) public quotes; // stock token => listing
    address[] public listed; // enumeration

    event OwnerChanged(address indexed from, address indexed to);
    event StockListed(address indexed token, address oracle, uint8 decimals, string symbol);
    event OracleUpdated(address indexed token, address oracle);
    event ListingFrozen();

    error OnlyOwner();
    error Frozen();
    error AlreadyListed();
    error NotListed();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address _owner) {
        owner = _owner;
        emit OwnerChanged(address(0), _owner);
    }

    // ── governance: add-only, funds-safe ─────────────────────────────────────
    /// List a tokenized stock as an allowed quote currency.
    function listStock(address token, address oracle, uint8 decimals, string calldata symbol) external onlyOwner {
        if (listingFrozen) revert Frozen();
        if (token == address(0) || oracle == address(0)) revert ZeroAddress();
        if (quotes[token].listed) revert AlreadyListed();
        quotes[token] = Quote({listed: true, oracle: oracle, decimals: decimals, symbol: symbol});
        listed.push(token);
        emit StockListed(token, oracle, decimals, symbol);
    }

    /// Point an already-listed stock at a new/better oracle. Cannot list or
    /// delist — only swaps the price source for a stock that is already allowed.
    function updateOracle(address token, address oracle) external onlyOwner {
        if (!quotes[token].listed) revert NotListed();
        if (oracle == address(0)) revert ZeroAddress();
        quotes[token].oracle = oracle;
        emit OracleUpdated(token, oracle);
    }

    /// Permanently stop new listings (the set becomes immutable).
    function freezeListing() external onlyOwner {
        listingFrozen = true;
        emit ListingFrozen();
    }

    function transferOwnership(address to) external onlyOwner {
        emit OwnerChanged(owner, to);
        owner = to; // pass to a multisig, or to address(0) to renounce.
    }

    // ── views used by the factory ────────────────────────────────────────────
    /// A quote is valid if it's native ETH (address(0)) or a listed stock.
    function isAllowedQuote(address quote) external view returns (bool) {
        return quote == address(0) || quotes[quote].listed;
    }

    /// USD price (1e8) of 1 whole unit of the quote. For ETH, callers use the
    /// ETH/USD oracle directly; this reverts for ETH so misuse is caught.
    function quoteUsd1e8(address quote) external view returns (uint256) {
        Quote storage q = quotes[quote];
        if (!q.listed) revert NotListed();
        return IUsdOracle(q.oracle).usd1e8();
    }

    function listedCount() external view returns (uint256) {
        return listed.length;
    }
}
