// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @title StockRegistry
/// @notice The allowlist of *quote* currencies a coin may pair against.
///
///         Native ETH is always allowed. Every other quote must be a real,
///         on-chain tokenized stock (e.g. Robinhood's AAPL/NVDA/TSLA tokens) that
///         has been listed here. There is NO price oracle: a coin's starting
///         price is denominated directly in the quote at launch, so this registry
///         is a pure, fully on-chain allowlist with no external dependency.
///
///         Governance is minimal and *funds-safe*: the owner can ADD a stock and
///         freeze listings, but there is NO function that removes a listed stock,
///         moves anyone's tokens, or touches fees/LP. The gatekeeping only stops
///         fake/scam "stocks" from being paired; it never gives governance power
///         over user funds. Ownership can be renounced once the set is final.
contract StockRegistry {
    struct Quote {
        bool listed;
        uint8 decimals; // cached token decimals (read on-chain at listing)
        string symbol; // display only, e.g. "AAPL"
    }

    address public owner;
    bool public listingFrozen; // once true, no new stocks can ever be added

    mapping(address => Quote) public quotes; // stock token => listing
    address[] public listed; // enumeration

    event OwnerChanged(address indexed from, address indexed to);
    event StockListed(address indexed token, uint8 decimals, string symbol);
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
    /// List a real tokenized stock as an allowed quote currency. `decimals` is
    /// read from the token itself so it can't be spoofed by the owner.
    function listStock(address token, string calldata symbol) external onlyOwner {
        if (listingFrozen) revert Frozen();
        if (token == address(0)) revert ZeroAddress();
        if (quotes[token].listed) revert AlreadyListed();
        uint8 dec = IERC20Decimals(token).decimals();
        quotes[token] = Quote({listed: true, decimals: dec, symbol: symbol});
        listed.push(token);
        emit StockListed(token, dec, symbol);
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

    /// Decimals of a listed quote (18 for ETH). Used for display / price scaling.
    function quoteDecimals(address quote) external view returns (uint8) {
        if (quote == address(0)) return 18;
        Quote storage q = quotes[quote];
        if (!q.listed) revert NotListed();
        return q.decimals;
    }

    function listedCount() external view returns (uint256) {
        return listed.length;
    }
}
