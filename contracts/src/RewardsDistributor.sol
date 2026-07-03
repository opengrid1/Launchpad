// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";
import {IRewardsDistributor} from "./interfaces/IRewardsDistributor.sol";

interface IERC20Balance {
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
}

/// @title RewardsDistributor
/// @notice Receives the 1% ETH tax (from the v4 hook) and splits every deposit
///         three ways:
///           • holders  — pro-rata, via an O(1) accumulator (no loops, no rebase)
///           • creator  — claimable ETH
///           • protocol — sent to the Treasury, which funds hyped-token buybacks
///                        and loyalty airdrops. The protocol NEVER touches any
///                        coin's liquidity; it only spends its own fee slice.
///
///         All ETH is pull-based. Excluded accounts (the pool manager, this
///         contract, the treasury, the airdrop escrow) never accrue holder
///         rewards and are removed from the eligible supply.
contract RewardsDistributor is IRewardsDistributor {
    // ── split (basis points, sum = 10_000) ───────────────────────────────────
    uint256 public constant HOLDER_BPS   = 4500; // 45%
    uint256 public constant CREATOR_BPS  = 4500; // 45%
    uint256 public constant PROTOCOL_BPS = 1000; // 10%
    uint256 private constant ACC = 1e18;         // accumulator scaling

    address public immutable factory;
    address public immutable hook;
    address public immutable poolManager; // holds pool reserves → excluded
    address public immutable treasury;    // receives the protocol slice

    struct Coin {
        address token;
        address creator;
        bool registered;
        uint256 accRewardPerToken;              // cumulative ETH-per-token * ACC
        uint256 creatorOwed;                    // ETH owed to the creator
        mapping(address => uint256) rewardDebt; // holder's snapshot of acc
        mapping(address => uint256) pending;    // holder's settled, unclaimed ETH
    }
    mapping(address => Coin) private coins;      // token => rewards state
    mapping(address => bool) public excluded;    // never accrues holder rewards

    event Deposited(address indexed token, uint256 toHolders, uint256 toCreator, uint256 toProtocol);
    event Claimed(address indexed token, address indexed user, uint256 amount);
    event CreatorClaimed(address indexed token, address indexed creator, uint256 amount);

    error OnlyFactory();
    error OnlyHook();
    error OnlyToken();
    error NotRegistered();

    constructor(address _factory, address _hook, address _poolManager, address _treasury) {
        factory = _factory;
        hook = _hook;
        poolManager = _poolManager;
        treasury = _treasury;
        excluded[_poolManager] = true;
        excluded[address(this)] = true;
        excluded[_treasury] = true;
        excluded[address(0)] = true;
    }

    // ── registration (factory only) ───────────────────────────────────────────
    function register(PoolId, address token, address creator) external {
        if (msg.sender != factory) revert OnlyFactory();
        Coin storage c = coins[token];
        c.token = token;
        c.creator = creator;
        c.registered = true;
    }

    /// Owner-free infra exclusion: the factory can mark protocol escrow addresses
    /// (e.g. the loyalty-airdrop contract) as excluded at wiring time.
    function setExcluded(address account, bool isExcluded) external {
        if (msg.sender != factory) revert OnlyFactory();
        excluded[account] = isExcluded;
    }

    // ── deposit (hook only): split 45/45/10 ───────────────────────────────────
    function deposit(address token) external payable {
        if (msg.sender != hook) revert OnlyHook();
        Coin storage c = coins[token];
        if (!c.registered) revert NotRegistered();

        uint256 amount = msg.value;
        uint256 toProtocol = (amount * PROTOCOL_BPS) / 10_000;
        uint256 toCreator  = (amount * CREATOR_BPS) / 10_000;
        uint256 toHolders  = amount - toProtocol - toCreator; // remainder → no dust loss

        c.creatorOwed += toCreator;

        uint256 supply = _eligibleSupply(token);
        if (supply == 0) {
            // nobody eligible yet (all supply still in the pool) — route the
            // holder slice to the protocol treasury instead of stranding it.
            toProtocol += toHolders;
            toHolders = 0;
        } else {
            c.accRewardPerToken += (toHolders * ACC) / supply;
        }

        if (toProtocol > 0) {
            (bool ok,) = treasury.call{value: toProtocol}("");
            require(ok, "treasury xfer");
        }
        emit Deposited(token, toHolders, toCreator, toProtocol);
    }

    // ── settlement hook (token only), called before every balance change ──────
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
            uint256 bal = IERC20Balance(token).balanceOf(user);
            uint256 owed = (bal * (acc - c.rewardDebt[user])) / ACC;
            if (owed > 0) c.pending[user] += owed;
        }
        c.rewardDebt[user] = acc;
    }

    // ── claims (pull) ─────────────────────────────────────────────────────────
    function claim(address token) external {
        Coin storage c = coins[token];
        _settle(c, token, msg.sender);
        uint256 amt = c.pending[msg.sender];
        require(amt > 0, "nothing to claim");
        c.pending[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "eth xfer");
        emit Claimed(token, msg.sender, amt);
    }

    function claimCreator(address token) external {
        Coin storage c = coins[token];
        require(msg.sender == c.creator, "not creator");
        uint256 amt = c.creatorOwed;
        require(amt > 0, "nothing to claim");
        c.creatorOwed = 0;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "eth xfer");
        emit CreatorClaimed(token, msg.sender, amt);
    }

    // ── views ─────────────────────────────────────────────────────────────────
    function claimable(address token, address user) external view returns (uint256) {
        Coin storage c = coins[token];
        if (excluded[user]) return c.pending[user];
        uint256 bal = IERC20Balance(token).balanceOf(user);
        uint256 owed = (bal * (c.accRewardPerToken - c.rewardDebt[user])) / ACC;
        return c.pending[user] + owed;
    }

    function creatorOwed(address token) external view returns (uint256) {
        return coins[token].creatorOwed;
    }

    /// eligible = totalSupply − reserves held by the pool − protocol escrows.
    function _eligibleSupply(address token) internal view returns (uint256) {
        uint256 supply = IERC20Balance(token).totalSupply();
        supply -= IERC20Balance(token).balanceOf(poolManager);
        supply -= IERC20Balance(token).balanceOf(address(this));
        supply -= IERC20Balance(token).balanceOf(treasury);
        return supply;
    }

    receive() external payable {}
}
