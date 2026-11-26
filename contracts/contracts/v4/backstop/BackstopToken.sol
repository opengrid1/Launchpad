// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBackstopPoolGate {
    function spend(bool intoPool, uint256 amount) external;
}

interface IBackstopConverter {
    function pairToEth(address pair, uint256 amount, address to, uint256 minOut, bytes calldata route) external returns (uint256 ethOut);
    function pairToBasket(
        address pair,
        uint256 amount,
        address to,
        bytes calldata pairRoute,
        address[] calldata assets,
        bytes[] calldata routes,
        uint256[] calldata minOuts
    ) external returns (uint256[] memory outs);
}

/// @title BackstopToken
/// @notice A Backstop coin. Fixed supply, no owner, no mint, no pause, no
///         blacklist, no tax on transfers. The trade tax lives in the pool hook
///         and is split by the coin's strategy contract; this contract only
///         keeps holder rewards.
///
///         Holder rewards: the strategy pays the holder share of every trade
///         into {fund}; it is credited per coin held (MasterChef accumulator)
///         to every wallet except the pool and the launchpad's own contracts.
///         Holders claim in the backing (pair) token, as ETH through the
///         router, or as equal shares of the coin's reward basket (up to four
///         tokens, fixed at launch), each with their own minimum out.
///
///         One pool: the coin only enters or leaves the Uniswap V4 PoolManager
///         as part of a swap in its own pool (the hook grants exactly that
///         amount for the transaction), and it refuses transfers into any other
///         Uniswap V2/V3-style pool. Nobody can stand up a second pair for it.
///
///         Launch block: only the creator may receive coins from the pool, so
///         the creator's first buy can't be sniped in the same block. After
///         that, the pool hook's anti-snipe tax (if the creator chose one)
///         takes over.
contract BackstopToken is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant ACC_PRECISION = 1e30;

    address public immutable creator;
    /// @notice The backing token: the coin's pair, and what rewards are paid in.
    address public immutable pairAsset;
    address public immutable poolManager;
    address public immutable factory;
    address public immutable hook;
    /// @notice The launchpad router, for claims paid as ETH or a basket.
    address public immutable converter;
    uint256 public immutable launchBlock;
    /// @notice How the creator suggested holders take rewards: 0 backing token, 1 ETH, 2 basket.
    uint8 public immutable payout;

    /// @notice The coin's strategy contract (fee split, vault, buybacks); set once by the factory.
    address public strategy;

    uint256 private accRewardPerShare;
    /// @notice Supply that earns rewards (excludes the pool and system contracts).
    uint256 public eligibleSupply;
    mapping(address => uint256) private rewardDebt;
    mapping(address => uint256) public claimable;
    mapping(address => bool) public excluded;
    /// @notice Backing token held here that is owed to holders.
    uint256 public reserved;
    uint256 public totalHolderRewards;

    string private _metadataURI;
    uint256 public constant MAX_BASKET = 4;
    address[] private _basket;

    event Funded(address indexed from, uint256 amount);
    /// @dev payout: 0 backing token, 1 ETH, 2 basket.
    event RewardsClaimed(address indexed holder, uint256 amount, uint8 payout);
    event StrategySet(address indexed strategy);

    error LaunchGuard();
    error NoConverter();
    error NoHolders();
    error InvalidParams();
    error NoBasket();
    error NotFactory();
    error OtherPool();

    struct Init {
        string name;
        string symbol;
        string metadataURI;
        uint256 supply;
        address creator;
        address factory;
        address pairAsset;
        address poolManager;
        address hook;
        address converter;
        uint8 payout;
        address[] basket;
    }

    constructor(Init memory p) ERC20(p.name, p.symbol) {
        if (p.pairAsset == address(0) || p.factory == address(0) || p.hook == address(0) || p.payout > 2) revert InvalidParams();
        if (p.basket.length > MAX_BASKET || (p.payout == 2 && p.basket.length == 0)) revert InvalidParams();
        creator = p.creator;
        pairAsset = p.pairAsset;
        poolManager = p.poolManager;
        factory = p.factory;
        hook = p.hook;
        converter = p.converter;
        payout = p.payout;
        launchBlock = block.number;
        _metadataURI = p.metadataURI;
        for (uint256 i; i < p.basket.length; i++) {
            if (p.basket[i] == address(0)) revert InvalidParams();
            _basket.push(p.basket[i]);
        }
        excluded[address(0)] = true;
        excluded[address(this)] = true;
        excluded[p.factory] = true;
        excluded[p.poolManager] = true;
        excluded[p.hook] = true;
        if (p.converter != address(0)) excluded[p.converter] = true;
        _mint(p.factory, p.supply);
    }

    /// @notice One-time: the coin's strategy contract. Factory only, in the launch transaction.
    function setStrategy(address s) external {
        if (msg.sender != factory || strategy != address(0) || s == address(0)) revert NotFactory();
        strategy = s;
        excluded[s] = true;
        emit StrategySet(s);
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    function rewardToken() external view returns (address) {
        return pairAsset;
    }

    function basketAssets() external view returns (address[] memory) {
        return _basket;
    }

    // ------------------------------------------------------------------
    // Rewards
    // ------------------------------------------------------------------

    /// @notice Pay `amount` of the backing token to every eligible holder,
    ///         pulled from the caller. The strategy calls it with the holder
    ///         share of each trade; anyone may reward holders the same way.
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) return;
        uint256 supply = eligibleSupply;
        if (supply == 0) revert NoHolders();
        IERC20(pairAsset).safeTransferFrom(msg.sender, address(this), amount);
        accRewardPerShare += (amount * ACC_PRECISION) / supply;
        totalHolderRewards += amount;
        reserved += amount;
        emit Funded(msg.sender, amount);
    }

    function pendingRewards(address holder) public view returns (uint256) {
        if (excluded[holder]) return claimable[holder];
        uint256 accrued = (balanceOf(holder) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[holder];
        return claimable[holder] + (accrued > debt ? accrued - debt : 0);
    }

    /// @notice Claim your rewards in the backing token.
    function claimRewards() external nonReentrant returns (uint256 amount) {
        return _claimTo(msg.sender, 0, 0, "");
    }

    /// @notice Claim your rewards as native ETH, swapped by the router along
    ///         `route` (empty when the backing token is WETH).
    function claimRewardsAsEth(uint256 minEthOut, bytes calldata route) external nonReentrant returns (uint256 amount) {
        return _claimTo(msg.sender, 1, minEthOut, route);
    }

    /// @notice Claim your rewards as equal shares of the basket.
    function claimRewardsAsBasket(bytes calldata pairRoute, bytes[] calldata routes, uint256[] calldata minOuts)
        external
        nonReentrant
        returns (uint256 amount)
    {
        if (_basket.length == 0) revert NoBasket();
        amount = _take(msg.sender);
        if (amount == 0) return 0;
        IERC20(pairAsset).forceApprove(converter, amount);
        IBackstopConverter(converter).pairToBasket(pairAsset, amount, msg.sender, pairRoute, _basket, routes, minOuts);
        emit RewardsClaimed(msg.sender, amount, 2);
    }

    /// @notice Push a holder's rewards to them, in the backing token. Anyone.
    function claimFor(address holder) external nonReentrant returns (uint256 amount) {
        return _claimTo(holder, 0, 0, "");
    }

    /// @notice Burn coins you hold.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _take(address holder) private returns (uint256 amount) {
        _settle(holder);
        amount = claimable[holder];
        if (amount == 0) return 0;
        claimable[holder] = 0;
        reserved -= amount;
    }

    function _claimTo(address holder, uint8 how, uint256 minEthOut, bytes memory route) private returns (uint256 amount) {
        amount = _take(holder);
        if (amount == 0) return 0;
        if (how == 0) {
            IERC20(pairAsset).safeTransfer(holder, amount);
        } else {
            address c = converter;
            if (c == address(0)) revert NoConverter();
            IERC20(pairAsset).forceApprove(c, amount);
            IBackstopConverter(c).pairToEth(pairAsset, amount, holder, minEthOut, route);
        }
        emit RewardsClaimed(holder, amount, how);
    }

    function _settle(address account) private {
        if (account == address(0) || excluded[account]) return;
        uint256 accrued = (balanceOf(account) * accRewardPerShare) / ACC_PRECISION;
        uint256 debt = rewardDebt[account];
        if (accrued > debt) claimable[account] += accrued - debt;
        rewardDebt[account] = accrued;
    }

    function _resetDebt(address account) private {
        rewardDebt[account] = (balanceOf(account) * accRewardPerShare) / ACC_PRECISION;
    }

    /// @dev The coin's own launchpad contracts move it freely; everyone else
    ///      reaches the PoolManager only through a swap in the coin's own pool,
    ///      and never reaches another V2/V3-style pool.
    function _gate(address from, address to, uint256 value) private {
        address pm = poolManager;
        if (to == pm) {
            if (from != address(0) && !_system(from)) IBackstopPoolGate(hook).spend(true, value);
        } else if (from == pm) {
            if (!_system(to)) IBackstopPoolGate(hook).spend(false, value);
        } else if (to != address(0) && to.code.length != 0 && !excluded[to] && _isPoolOfThis(to)) {
            revert OtherPool();
        }
    }

    function _system(address a) private view returns (bool) {
        return a == factory || a == strategy || a == hook;
    }

    /// @dev A Uniswap V2/V3-style pool that holds this coin (token0 or token1 is this).
    function _isPoolOfThis(address a) private view returns (bool) {
        return _side(a, 0x0dfe1681) || _side(a, 0xd21220a7); // token0(), token1()
    }

    function _side(address a, bytes4 sel) private view returns (bool) {
        (bool ok, bytes memory r) = a.staticcall{gas: 10_000}(abi.encodeWithSelector(sel));
        return ok && r.length == 32 && abi.decode(r, (address)) == address(this);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Launch block: coins leaving the pool (or the router passing them on) may only reach the creator.
        if (block.number == launchBlock && (from == poolManager || (from == converter && from != address(0))) && !excluded[to] && value > 0) {
            if (to != creator) revert LaunchGuard();
        }
        if (value > 0) _gate(from, to, value);
        bool fromEligible = from != address(0) && !excluded[from];
        bool toEligible = to != address(0) && !excluded[to];
        if (fromEligible) _settle(from);
        if (toEligible) _settle(to);
        super._update(from, to, value);
        if (fromEligible && !toEligible) eligibleSupply -= value;
        else if (!fromEligible && toEligible) eligibleSupply += value;
        if (fromEligible) _resetDebt(from);
        if (toEligible) _resetDebt(to);
    }
}
