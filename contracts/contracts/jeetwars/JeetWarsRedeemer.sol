// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBurnableCoin {
    function totalSupply() external view returns (uint256);
    function burnFrom(address account, uint256 amount) external;
}

/// @title JeetWarsRedeemer
/// @notice Holds what the merge bought for each losing coin and pays it out to
///         that coin's holders. Redeeming burns your losing coins and sends you
///         your share of the winner tokens (plus any BNB the merge didn't spend),
///         pro rata to the losing coin's supply. Every holder gets the same rate,
///         and there is no deadline. The Arena registers each loser once.
contract JeetWarsRedeemer is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable deployer;
    address public arena;

    struct Pot {
        address winner;
        uint128 tokens; // winner tokens left to pay out
        uint128 bnb; // BNB left to pay out
        uint256 supply; // losing coins not yet redeemed
        uint32 round;
    }

    mapping(address => Pot) public pots;

    event ArenaSet(address indexed arena);
    event Registered(address indexed loser, address indexed winner, uint32 round, uint256 tokens, uint256 bnb, uint256 supply);
    event Redeemed(address indexed loser, address indexed holder, uint256 burned, uint256 tokens, uint256 bnb);

    error NotDeployer();
    error NotArena();
    error AlreadySet();
    error ZeroAddress();
    error NotRedeemable();
    error ZeroAmount();
    error TransferFailed();

    constructor() {
        deployer = msg.sender;
    }

    /// @notice One-time wiring of the Arena.
    function setArena(address arena_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (arena != address(0)) revert AlreadySet();
        if (arena_ == address(0)) revert ZeroAddress();
        arena = arena_;
        emit ArenaSet(arena_);
    }

    /// @notice Open redemption for `loser`. The winner tokens are already here;
    ///         any unspent BNB comes with the call.
    function register(address loser, address winner, uint32 round, uint256 tokens) external payable {
        if (msg.sender != arena) revert NotArena();
        Pot storage p = pots[loser];
        if (p.winner != address(0)) revert AlreadySet();
        uint256 supply = IBurnableCoin(loser).totalSupply();
        p.winner = winner;
        p.tokens = uint128(tokens);
        p.bnb = uint128(msg.value);
        p.supply = supply;
        p.round = round;
        emit Registered(loser, winner, round, tokens, msg.value, supply);
    }

    /// @notice What redeeming `amount` of `loser` pays right now.
    function quote(address loser, uint256 amount) public view returns (uint256 tokens, uint256 bnb) {
        Pot storage p = pots[loser];
        if (p.winner == address(0) || p.supply == 0 || amount == 0) return (0, 0);
        if (amount > p.supply) amount = p.supply;
        tokens = (uint256(p.tokens) * amount) / p.supply;
        bnb = (uint256(p.bnb) * amount) / p.supply;
    }

    /// @notice Burn `amount` of a losing coin (approve this contract first) and
    ///         receive your share of the winner, sent to `to`.
    function redeem(address loser, uint256 amount, address to) external nonReentrant returns (uint256 tokens, uint256 bnb) {
        if (amount == 0) revert ZeroAmount();
        Pot storage p = pots[loser];
        if (p.winner == address(0)) revert NotRedeemable();
        (tokens, bnb) = quote(loser, amount);
        IBurnableCoin(loser).burnFrom(msg.sender, amount);
        p.supply -= amount;
        p.tokens -= uint128(tokens);
        p.bnb -= uint128(bnb);
        if (tokens > 0) IERC20(p.winner).safeTransfer(to, tokens);
        if (bnb > 0) {
            (bool ok,) = to.call{value: bnb}("");
            if (!ok) revert TransferFailed();
        }
        emit Redeemed(loser, msg.sender, amount, tokens, bnb);
    }
}
