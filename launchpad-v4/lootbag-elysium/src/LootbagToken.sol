// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title LootbagToken
/// @notice The coin every Lootbag launch deploys (an EIP-1167 clone): a fixed-supply ERC-20 that keeps its holders'
///         rewards. Every trade's holder share (paid in the coin's quote currency) is added to a reward-per-token
///         accumulator, so each holder's share is exact and follows their balance through every transfer. The payout
///         contract then pays it out (in the coin's current reward token) without the holder claiming anything; a
///         holder can also take their own share at any time.
/// @dev Who earns: every wallet except the excluded ones, which hold coins that are not anyone's (the pool's
///      PoolManager, the hook, the payout contract, the burn address), the creator (never paid from their own coin)
///      and every wallet that received coins in the launch block (snipers and bundles: they keep their coins and
///      trade them like anyone, but never earn). Excluded balances don't count in the supply the rewards are
///      shared over. No owner, no mint after launch, no transfer tax, no blacklist.
contract LootbagToken {
    error AlreadyInitialized();
    error InsufficientBalance();
    error InsufficientAllowance();
    error NotFactory();
    error NotPayout();
    error ZeroAddress();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    /// @notice Holder rewards added: `amount` of the quote currency, shared over `eligibleSupply`
    event RewardAdded(uint256 amount, uint256 eligibleSupply);
    /// @notice `account` stopped earning (a system address, the creator or a launch-block buyer)
    event Excluded(address indexed account);
    /// @notice `amount` of `account`'s rewards (quote currency) taken out to be paid to them
    event RewardTaken(address indexed account, uint256 amount);

    /// @dev rewards are kept per token in units of 1e-36 quote per coin, so tiny trades on a 1B supply still count
    uint256 private constant ACC = 1e36;

    uint8 public constant decimals = 18;
    /// @notice the factory that launches every Lootbag coin (the same for every clone: it deployed the implementation)
    address public immutable factory;

    string public name;
    string public symbol;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice the payout contract, the only one that adds rewards and pays them out
    address public payout;
    /// @notice the creator, who never earns from their own coin
    address public creator;
    /// @notice the block the coin launched in: every wallet that receives coins in it never earns
    uint64 public launchBlock;

    /// @notice holder rewards per coin, scaled by 1e36, in the quote currency
    uint256 public rewardPerToken;
    /// @notice the coins held by excluded wallets, which earn nothing
    uint256 public excludedSupply;
    /// @notice the rewards added while nobody was eligible, added to the next reward
    uint256 public pendingReward;
    mapping(address => bool) public excluded;
    mapping(address => uint256) private _paidPerToken;
    mapping(address => uint256) private _accrued;

    constructor() {
        factory = msg.sender;
        totalSupply = 1; // the implementation itself can never be initialized
    }

    /// @notice One-time setup of a fresh clone, in the launch transaction: metadata, the whole supply to the factory
    ///         (which puts it into the pool), the payout contract and the creator.
    function initialize(string calldata name_, string calldata symbol_, uint256 supply, address payout_, address creator_)
        external
    {
        if (totalSupply != 0) revert AlreadyInitialized();
        if (msg.sender != factory) revert NotFactory();
        if (payout_ == address(0) || creator_ == address(0) || supply == 0) revert ZeroAddress();
        name = name_;
        symbol = symbol_;
        totalSupply = supply;
        payout = payout_;
        creator = creator_;
        launchBlock = uint64(block.number);
        // the factory holds the supply only for this transaction; it is excluded so it never counts
        _exclude(msg.sender);
        _exclude(creator_);
        _exclude(payout_);
        _exclude(address(0xdEaD));
        balanceOf[msg.sender] = supply;
        excludedSupply += supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    /// @notice The factory excludes the launch's system addresses (PoolManager, hook) in the launch transaction
    function exclude(address account) external {
        if (msg.sender != factory) revert NotFactory();
        _exclude(account);
    }

    // ------------------------------------------------------------------ ERC-20

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            if (a < value) revert InsufficientAllowance();
            allowance[from][msg.sender] = a - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert ZeroAddress();
        // a wallet that receives coins in the launch block never earns (the dev buy goes to the excluded creator)
        if (block.number == launchBlock && !excluded[to]) _exclude(to);
        _settle(from);
        _settle(to);
        uint256 b = balanceOf[from];
        if (b < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = b - value;
        }
        balanceOf[to] += value;
        bool fx = excluded[from];
        bool tx_ = excluded[to];
        if (fx && !tx_) excludedSupply -= value;
        else if (!fx && tx_) excludedSupply += value;
        emit Transfer(from, to, value);
    }

    // ------------------------------------------------------------------ rewards

    /// @notice The coins that earn: the supply less every excluded wallet's
    function eligibleSupply() public view returns (uint256) {
        return totalSupply - excludedSupply;
    }

    /// @notice `account`'s rewards so far that have not been paid out, in the quote currency
    function earned(address account) public view returns (uint256) {
        if (excluded[account]) return _accrued[account];
        return _accrued[account] + (balanceOf[account] * (rewardPerToken - _paidPerToken[account])) / ACC;
    }

    /// @notice The payout contract adds `amount` of holder rewards (it already holds the quote currency)
    function addReward(uint256 amount) external {
        if (msg.sender != payout) revert NotPayout();
        uint256 total = amount + pendingReward;
        uint256 eligible = eligibleSupply();
        if (eligible == 0) {
            pendingReward = total; // nobody earns yet: it waits for the first holder
            return;
        }
        pendingReward = 0;
        rewardPerToken += (total * ACC) / eligible;
        emit RewardAdded(total, eligible);
    }

    /// @notice The payout contract takes `account`'s rewards to pay them out (it sends them on, in the reward token)
    function take(address account) external returns (uint256 amount) {
        if (msg.sender != payout) revert NotPayout();
        _settle(account);
        amount = _accrued[account];
        if (amount != 0) {
            _accrued[account] = 0;
            emit RewardTaken(account, amount);
        }
    }

    function _settle(address account) internal {
        uint256 r = rewardPerToken;
        uint256 paid = _paidPerToken[account];
        if (paid == r) return;
        if (!excluded[account]) _accrued[account] += (balanceOf[account] * (r - paid)) / ACC;
        _paidPerToken[account] = r;
    }

    function _exclude(address account) internal {
        if (excluded[account]) return;
        _settle(account);
        excluded[account] = true;
        uint256 b = balanceOf[account];
        if (b != 0) excludedSupply += b;
        emit Excluded(account);
    }
}
