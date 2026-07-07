// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20Min {
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

interface IBurnable {
    function burn(uint256 amount) external;
}

/// @notice Swaps a coin's *quote* currency into the coin, for creator buybacks.
///         Kept behind an interface so the (v4-specific, hard-to-unit-test) swap
///         wiring lives outside this accounting core. The executor must send the
///         bought coins back to `recipient` (the distributor), which then burns
///         them — the executor never keeps anything.
interface IBuybackExecutor {
    function buyback(address token, address quote, uint256 amountIn, address recipient)
        external
        payable
        returns (uint256 bought);
}

/// @title RewardsDistributorV2
/// @notice The 1% trade tax lands here (pushed by the hook on *every* swap) and
///         is split exactly 50/50:
///           • 50% to holders — pro-rata, O(1) accumulator, single-step `claim`.
///             There is NO separate "collect" step: the hook forwards the tax on
///             each swap, so a holder's reward is always live and claimable in one
///             transaction.
///           • 50% to the creator — either claimable directly, or (if the creator
///             turns buyback ON) pooled into a buyback fund that anyone can spend
///             to buy the coin and BURN it. The creator can toggle this anytime.
///
///         Rewards are paid in the coin's *quote* currency: native ETH for an
///         ETH-paired coin, or the paired stock token for a stock-paired coin.
///         "Choose your reward" = choose what you pair against at launch.
///
///         No protocol cut, no treasury, no admin over funds. The 50/50 split is a
///         hardcoded constant with no setter. The only privileged action is the
///         creator toggling their OWN buyback, which can never move holder funds.
contract RewardsDistributorV2 {
    uint256 public constant HOLDER_BPS = 5000; // 50%
    uint256 public constant CREATOR_BPS = 5000; // 50%
    uint256 private constant ACC = 1e18; // accumulator scaling

    address public immutable factory;
    address public immutable hook;
    address public immutable poolManager; // holds pool reserves → excluded from holder rewards
    // Trusted, fixed contract that performs the buyback swap (quote -> coin) and
    // returns the bought coins here to be burned. Set once at construction — it
    // is NOT a caller-supplied parameter, so the buyback fund can never be routed
    // to an arbitrary address (fixes the fund-theft where anyone could pass their
    // own "executor" and keep the fund).
    IBuybackExecutor public immutable buybackExecutor;

    // ── reentrancy guard ──────────────────────────────────────────────────────
    uint256 private _locked = 1;
    modifier nonReentrant() {
        require(_locked == 1, "reentrant");
        _locked = 2;
        _;
        _locked = 1;
    }

    struct Coin {
        address token;
        address creator;
        address quote; // reward currency: address(0) = native ETH, else ERC20 (a stock)
        bool registered;
        bool buybackOn; // creator's 50% → buyback+burn instead of claimable
        uint256 accRewardPerToken; // cumulative quote-per-token * ACC
        uint256 creatorOwed; // quote owed to the creator (when buyback off)
        uint256 buybackFund; // quote pooled for buyback (when buyback on)
        mapping(address => uint256) rewardDebt;
        mapping(address => uint256) pending;
    }

    mapping(address => Coin) private coins; // token => state
    mapping(address => bool) public excluded; // never accrues holder rewards

    event Registered(address indexed token, address indexed creator, address quote);
    event Deposited(address indexed token, uint256 toHolders, uint256 toCreatorSide, bool buyback);
    event Claimed(address indexed token, address indexed user, uint256 amount);
    event CreatorClaimed(address indexed token, address indexed creator, uint256 amount);
    event BuybackSet(address indexed token, bool on);
    event BuybackExecuted(address indexed token, uint256 quoteSpent, uint256 coinsBurned);

    error OnlyFactory();
    error OnlyHook();
    error OnlyToken();
    error OnlyCreator();
    error NotRegistered();
    error WrongQuote();
    error Nothing();
    error EthXfer();

    constructor(address _factory, address _hook, address _poolManager, address _buybackExecutor) {
        factory = _factory;
        hook = _hook;
        poolManager = _poolManager;
        buybackExecutor = IBuybackExecutor(_buybackExecutor);
        excluded[_poolManager] = true;
        excluded[address(this)] = true;
        excluded[address(0)] = true;
    }

    // ── registration (factory only) ───────────────────────────────────────────
    function register(address token, address creator, address quote, bool buybackOn) external {
        if (msg.sender != factory) revert OnlyFactory();
        Coin storage c = coins[token];
        c.token = token;
        c.creator = creator;
        c.quote = quote;
        c.buybackOn = buybackOn;
        c.registered = true;
        emit Registered(token, creator, quote);
    }

    // ── deposit (hook only) ───────────────────────────────────────────────────
    // ETH-quote coins: hook calls depositETH{value: fee}(token).
    // ERC20-quote coins: hook transfers `amount` of the quote to this contract,
    // then calls depositERC20(token, amount).
    function depositETH(address token) external payable {
        if (msg.sender != hook) revert OnlyHook();
        Coin storage c = coins[token];
        if (!c.registered) revert NotRegistered();
        if (c.quote != address(0)) revert WrongQuote();
        _split(c, token, msg.value);
    }

    function depositERC20(address token, uint256 amount) external {
        if (msg.sender != hook) revert OnlyHook();
        Coin storage c = coins[token];
        if (!c.registered) revert NotRegistered();
        if (c.quote == address(0)) revert WrongQuote();
        // funds must already have been transferred to this contract by the hook.
        _split(c, token, amount);
    }

    function _split(Coin storage c, address token, uint256 amount) internal {
        if (amount == 0) return;
        uint256 toCreator = (amount * CREATOR_BPS) / 10_000;
        uint256 toHolders = amount - toCreator; // remainder → no dust loss

        // creator side: buyback fund or claimable
        if (c.buybackOn) c.buybackFund += toCreator;
        else c.creatorOwed += toCreator;

        // holder side: pro-rata accumulator
        uint256 supply = _eligibleSupply(token);
        if (supply == 0) {
            // no eligible holders yet (all supply still in the pool): fold the
            // holder slice into the creator side so nothing is stranded.
            if (c.buybackOn) c.buybackFund += toHolders;
            else c.creatorOwed += toHolders;
        } else {
            c.accRewardPerToken += (toHolders * ACC) / supply;
        }
        emit Deposited(token, toHolders, toCreator, c.buybackOn);
    }

    // ── settlement hook (token only), before every balance change ─────────────
    function onTokenMove(address token, address from, address to) external {
        if (msg.sender != token) revert OnlyToken();
        Coin storage c = coins[token];
        if (!c.registered) return;
        _settle(c, token, from);
        _settle(c, token, to);
    }

    function _settle(Coin storage c, address token, address user) internal {
        uint256 acc = c.accRewardPerToken;
        if (!excluded[user]) {
            uint256 bal = IERC20Min(token).balanceOf(user);
            uint256 owed = (bal * (acc - c.rewardDebt[user])) / ACC;
            if (owed > 0) c.pending[user] += owed;
        }
        c.rewardDebt[user] = acc;
    }

    // ── holder claim (single step, pull) ──────────────────────────────────────
    function claim(address token) external nonReentrant {
        Coin storage c = coins[token];
        _settle(c, token, msg.sender);
        uint256 amt = c.pending[msg.sender];
        if (amt == 0) revert Nothing();
        c.pending[msg.sender] = 0;
        _payout(c.quote, msg.sender, amt);
        emit Claimed(token, msg.sender, amt);
    }

    // ── creator claim (only when buyback is off) ──────────────────────────────
    function claimCreator(address token) external nonReentrant {
        Coin storage c = coins[token];
        if (msg.sender != c.creator) revert OnlyCreator();
        uint256 amt = c.creatorOwed;
        if (amt == 0) revert Nothing();
        c.creatorOwed = 0;
        _payout(c.quote, msg.sender, amt);
        emit CreatorClaimed(token, msg.sender, amt);
    }

    // ── creator toggles their own buyback ─────────────────────────────────────
    function setBuyback(address token, bool on) external {
        Coin storage c = coins[token];
        if (msg.sender != c.creator) revert OnlyCreator();
        c.buybackOn = on;
        emit BuybackSet(token, on);
    }

    // ── execute a buyback: spend the fund to buy the coin, then burn it ───────
    //    Permissionless to *trigger*, but the fund is always handed to the fixed,
    //    trusted `buybackExecutor` (set at construction) and whatever coin it
    //    delivers is burned. There is no caller-supplied executor, so the fund can
    //    never be routed to an arbitrary address.
    function executeBuyback(address token) external nonReentrant returns (uint256 burned) {
        Coin storage c = coins[token];
        if (!c.registered) revert NotRegistered();
        uint256 fund = c.buybackFund;
        if (fund == 0) revert Nothing();
        c.buybackFund = 0;

        if (c.quote == address(0)) {
            buybackExecutor.buyback{value: fund}(token, c.quote, fund, address(this));
        } else {
            _safeApprove(c.quote, address(buybackExecutor), fund);
            buybackExecutor.buyback(token, c.quote, fund, address(this));
        }
        // burn everything the executor delivered.
        burned = IERC20Min(token).balanceOf(address(this));
        if (burned > 0) IBurnable(token).burn(burned);
        emit BuybackExecuted(token, fund, burned);
    }

    // ── views ─────────────────────────────────────────────────────────────────
    function claimable(address token, address user) external view returns (uint256) {
        Coin storage c = coins[token];
        if (excluded[user]) return c.pending[user];
        uint256 bal = IERC20Min(token).balanceOf(user);
        uint256 owed = (bal * (c.accRewardPerToken - c.rewardDebt[user])) / ACC;
        return c.pending[user] + owed;
    }

    function creatorOwed(address token) external view returns (uint256) {
        return coins[token].creatorOwed;
    }

    function buybackFund(address token) external view returns (uint256) {
        return coins[token].buybackFund;
    }

    function info(address token)
        external
        view
        returns (address creator, address quote, bool buybackOn, bool registered)
    {
        Coin storage c = coins[token];
        return (c.creator, c.quote, c.buybackOn, c.registered);
    }

    function _eligibleSupply(address token) internal view returns (uint256) {
        uint256 supply = IERC20Min(token).totalSupply();
        supply -= IERC20Min(token).balanceOf(poolManager);
        supply -= IERC20Min(token).balanceOf(address(this));
        return supply;
    }

    function _payout(address quote, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (quote == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert EthXfer();
        } else {
            _safeTransfer(quote, to, amount);
        }
    }

    // ── minimal SafeERC20: tolerate tokens that return nothing, revert on false ─
    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount)); // approve
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "approve failed");
    }

    receive() external payable {}
}
