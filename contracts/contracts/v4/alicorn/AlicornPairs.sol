// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
    function token0() external view returns (address);
}

/// @title AlicornPairs
/// @notice The pair-asset registry for the Alicorn factory. A coin can be
///         launched against any ERC-20 on Ethereum:
///
///           - curated pairs are set by the admin with a USD price and an
///             optional Chainlink feed (tokenized stocks, tokens with feeds);
///           - any other token registers itself, permissionlessly, from its
///             deepest Uniswap V3 pool against WETH. That pool gives the
///             price (spot, times Chainlink ETH/USD) and the ETH route the
///             router uses for buys, sells and ETH claims.
///
///         The factory calls {ensure} at launch, so pairing with a new token
///         needs no extra transaction. The admin can block a token.
contract AlicornPairs {
    uint256 public constant FEED_MAX_AGE = 7 days;
    /// @notice A token registers itself only if some V3 pool against WETH
    ///         holds at least this much WETH.
    uint256 public constant MIN_POOL_WETH = 1 ether;

    address public immutable weth;
    address public immutable admin;
    IUniswapV3Factory public immutable v3Factory;
    IAggregatorV3 public immutable ethUsdFeed;
    /// @notice Deployer, for setup only; zero once renounced.
    address public owner;

    struct QuoteAsset {
        bool approved;
        /// @dev Admin-blocked: cannot register itself again.
        bool blocked;
        uint8 decimals;
        /// @dev Self-registered pairs: the WETH/pair V3 fee tier that prices and routes it.
        uint24 v3Fee;
        /// @dev Admin USD price per whole token, 8 dp (fallback for feeds and pools).
        uint64 usdPrice8;
        /// @dev Optional Chainlink USD feed, 8 dp; wins when fresh.
        address feed;
    }
    mapping(address => QuoteAsset) public quoteAssets;
    address[] public quoteList;

    event QuoteAssetSet(address indexed pair, bool approved, uint64 usdPrice8, address feed);
    event PairRegistered(address indexed pair, address indexed by, uint24 v3Fee, uint8 decimals, uint256 usdPrice8);
    event PairBlocked(address indexed pair, bool blocked);
    event OwnershipRenounced();

    error NotAdmin();
    error InvalidParams();
    error ZeroAddress();
    error QuoteNotApproved();
    error NoPrice();
    error NoPool();
    error Blocked();

    modifier onlyAdminOrOwner() {
        if (msg.sender != admin && msg.sender != owner) revert NotAdmin();
        _;
    }

    constructor(address owner_, address admin_, address weth_, IUniswapV3Factory v3Factory_, IAggregatorV3 ethUsdFeed_, uint64 ethUsd8_) {
        if (admin_ == address(0) || weth_ == address(0) || address(v3Factory_) == address(0)) revert ZeroAddress();
        if (ethUsd8_ == 0) revert InvalidParams();
        if (address(ethUsdFeed_) != address(0) && ethUsdFeed_.decimals() != 8) revert InvalidParams();
        owner = owner_;
        admin = admin_;
        weth = weth_;
        v3Factory = v3Factory_;
        ethUsdFeed = ethUsdFeed_;
        quoteAssets[weth_] = QuoteAsset({approved: true, blocked: false, decimals: 18, v3Fee: 0, usdPrice8: ethUsd8_, feed: address(ethUsdFeed_)});
        quoteList.push(weth_);
        emit QuoteAssetSet(weth_, true, ethUsd8_, address(ethUsdFeed_));
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Curate a pair: approve, re-price, or retire it. `usdPrice8` is
    ///         USD per whole token (8 dp); `feed` an optional 8-decimal
    ///         Chainlink USD feed. Retiring (approved=false) also blocks
    ///         self-registration; approving again unblocks.
    function setQuoteAsset(address pair, bool approved, uint64 usdPrice8, address feed) external onlyAdminOrOwner {
        if (pair == address(0)) revert ZeroAddress();
        if (pair == weth && !approved) revert InvalidParams();
        if (approved && usdPrice8 == 0 && feed == address(0)) revert InvalidParams();
        if (feed != address(0) && IAggregatorV3(feed).decimals() != 8) revert InvalidParams();
        QuoteAsset storage q = quoteAssets[pair];
        uint8 dec = pair == weth ? 18 : IERC20Metadata(pair).decimals();
        if (dec > 18) revert InvalidParams();
        if (!q.approved && q.usdPrice8 == 0 && q.feed == address(0) && q.v3Fee == 0) quoteList.push(pair);
        q.approved = approved;
        q.blocked = !approved;
        q.decimals = dec;
        q.usdPrice8 = usdPrice8;
        q.feed = feed;
        emit QuoteAssetSet(pair, approved, usdPrice8, feed);
    }

    /// @notice Block or unblock a token from registering itself. Blocking also
    ///         retires it if it was self-registered.
    function setBlocked(address pair, bool blocked) external onlyAdminOrOwner {
        if (pair == weth) revert InvalidParams();
        QuoteAsset storage q = quoteAssets[pair];
        q.blocked = blocked;
        if (blocked && q.v3Fee != 0) q.approved = false;
        emit PairBlocked(pair, blocked);
    }

    /// @notice Give up the deployer's setup rights; the admin keeps its own.
    function renounceOwnership() external {
        if (msg.sender != owner) revert NotAdmin();
        owner = address(0);
        emit OwnershipRenounced();
    }

    // ---------------------------------------------------------------------
    // Permissionless registration
    // ---------------------------------------------------------------------

    /// @notice Register any ERC-20 as a pair asset from its deepest Uniswap V3
    ///         pool against WETH. Anyone may call; the factory calls it for you
    ///         at launch. Reverts when no pool holds MIN_POOL_WETH.
    function register(address pair) public returns (uint256 usdPrice8) {
        if (pair == address(0)) revert ZeroAddress();
        QuoteAsset storage q = quoteAssets[pair];
        if (q.blocked) revert Blocked();
        if (q.approved) return pairUsdPrice(pair);
        uint8 dec = IERC20Metadata(pair).decimals();
        if (dec > 18) revert InvalidParams();
        (address pool, uint24 fee) = _bestPool(pair);
        if (pool == address(0)) revert NoPool();
        if (q.usdPrice8 == 0 && q.feed == address(0) && q.v3Fee == 0) quoteList.push(pair);
        q.approved = true;
        q.decimals = dec;
        q.v3Fee = fee;
        usdPrice8 = _poolUsdPrice(pool, dec);
        if (usdPrice8 == 0) revert NoPrice();
        emit PairRegistered(pair, msg.sender, fee, dec, usdPrice8);
    }

    /// @notice Factory entry point: the pair's price and decimals, registering
    ///         it first when it is not approved yet.
    function ensure(address pair) external returns (uint256 usdPrice8, uint8 decimals) {
        QuoteAsset storage q = quoteAssets[pair];
        if (!q.approved) register(pair);
        if (!quoteAssets[pair].approved) revert QuoteNotApproved();
        return (pairUsdPrice(pair), quoteAssets[pair].decimals);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice USD per whole pair token, 8 dp: the Chainlink feed when set and
    ///         fresh, else the V3 pool spot for self-registered pairs, else
    ///         the admin price.
    function pairUsdPrice(address pair) public view returns (uint256) {
        QuoteAsset memory q = quoteAssets[pair];
        uint256 v = _feedPrice(q.feed);
        if (v > 0) return v;
        if (q.v3Fee != 0) {
            address pool = v3Factory.getPool(pair, weth, q.v3Fee);
            if (pool != address(0)) {
                v = _poolUsdPrice(pool, q.decimals);
                if (v > 0) return v;
            }
        }
        if (q.usdPrice8 == 0) revert NoPrice();
        return q.usdPrice8;
    }

    /// @notice USD per ETH, 8 dp: the feed when fresh, else the admin price.
    function ethUsdPrice() public view returns (uint256) {
        return pairUsdPrice(weth);
    }

    /// @notice The router route for a self-registered pair: the WETH -> pair
    ///         V3 hop, no V4 leg. Empty for WETH and for curated pairs (the
    ///         front end keeps those routes).
    function routeOf(address pair) external view returns (bytes memory) {
        QuoteAsset memory q = quoteAssets[pair];
        if (pair == weth || q.v3Fee == 0) return "";
        PoolKey memory none;
        return abi.encode(abi.encodePacked(weth, q.v3Fee, pair), none);
    }

    /// @notice What {register} would do for `pair`, for the front end.
    function preview(address pair)
        external
        view
        returns (bool ok, bool approved, bool blocked, uint24 v3Fee, uint8 decimals, uint256 usdPrice8, uint256 poolWeth)
    {
        QuoteAsset memory q = quoteAssets[pair];
        approved = q.approved;
        blocked = q.blocked;
        if (approved) {
            v3Fee = q.v3Fee;
            decimals = q.decimals;
            usdPrice8 = pairUsdPrice(pair);
            ok = true;
            if (v3Fee != 0) (, poolWeth) = _poolWeth(pair, v3Fee);
            return (ok, approved, blocked, v3Fee, decimals, usdPrice8, poolWeth);
        }
        if (blocked || pair == address(0)) return (false, approved, blocked, 0, 0, 0, 0);
        try IERC20Metadata(pair).decimals() returns (uint8 d) {
            decimals = d;
        } catch {
            return (false, approved, blocked, 0, 0, 0, 0);
        }
        if (decimals > 18) return (false, approved, blocked, 0, decimals, 0, 0);
        address pool;
        (pool, v3Fee) = _bestPool(pair);
        if (pool == address(0)) return (false, approved, blocked, 0, decimals, 0, 0);
        (, poolWeth) = _poolWeth(pair, v3Fee);
        usdPrice8 = _poolUsdPrice(pool, decimals);
        ok = usdPrice8 > 0;
    }

    function quoteCount() external view returns (uint256) {
        return quoteList.length;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _feedPrice(address feed) internal view returns (uint256) {
        if (feed == address(0)) return 0;
        try IAggregatorV3(feed).latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer > 0 && updatedAt + FEED_MAX_AGE >= block.timestamp) return uint256(answer);
        } catch {}
        return 0;
    }

    /// @dev The WETH/pair V3 pool holding the most WETH, if it holds at least MIN_POOL_WETH.
    function _bestPool(address pair) internal view returns (address best, uint24 bestFee) {
        uint24[4] memory fees = [uint24(100), 500, 3000, 10000];
        uint256 bestWeth;
        for (uint256 i = 0; i < 4; i++) {
            (address pool, uint256 held) = _poolWeth(pair, fees[i]);
            if (pool != address(0) && held > bestWeth) {
                best = pool;
                bestFee = fees[i];
                bestWeth = held;
            }
        }
        if (bestWeth < MIN_POOL_WETH) return (address(0), 0);
    }

    function _poolWeth(address pair, uint24 fee) internal view returns (address pool, uint256 held) {
        pool = v3Factory.getPool(pair, weth, fee);
        if (pool == address(0)) return (pool, 0);
        held = IERC20(weth).balanceOf(pool);
    }

    /// @dev USD per whole pair token from the pool's spot price and ETH/USD.
    function _poolUsdPrice(address pool, uint8 dec) internal view returns (uint256) {
        uint256 ethUsd8 = _feedPrice(address(ethUsdFeed));
        if (ethUsd8 == 0) ethUsd8 = quoteAssets[weth].usdPrice8;
        uint160 sqrtP;
        try IUniswapV3Pool(pool).slot0() returns (uint160 s, int24, uint16, uint16, uint16, uint8, bool) {
            sqrtP = s;
        } catch {
            return 0;
        }
        if (sqrtP == 0) return 0;
        uint256 num = ethUsd8 * (10 ** uint256(dec));
        if (IUniswapV3Pool(pool).token0() == weth) {
            // price = pair raw per WETH wei = sqrtP^2 / 2^192.
            // usd8 = ethUsd8 * 10^dec * 2^192 / (sqrtP^2 * 1e18)
            uint256 a = Math.mulDiv(num, 1 << 96, sqrtP);
            return Math.mulDiv(a, 1 << 96, uint256(sqrtP) * 1e18);
        }
        // price = WETH wei per pair raw = sqrtP^2 / 2^192.
        // usd8 = ethUsd8 * 10^dec * sqrtP^2 / (2^192 * 1e18)
        uint256 b = Math.mulDiv(num, sqrtP, 1 << 96);
        return Math.mulDiv(b, sqrtP, uint256(1 << 96) * 1e18);
    }
}
