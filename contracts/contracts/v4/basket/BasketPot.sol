// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {BasketOwnable} from "./BasketOwnable.sol";
import {ISlipstreamRouter, SwapPath} from "./ISlipstreamRouter.sol";

interface IBasketSupply {
    function totalSupply() external view returns (uint256);
}

/// @title BasketPot
/// @notice The Basket NFT pot and every NFT's vault in one contract.
///
///         Revenue lands here in the spend token (WETH): a share of protocol
///         revenue plus most of each NFT mint. Once an hour the keeper spends
///         5% of the pot's free balance on the day's token (a daily rotation
///         set by the admin) and credits an equal amount to every minted
///         Basket. Each Basket's credit is its vault: only the wallet that
///         holds the NFT can withdraw it, and unclaimed credit moves with the
///         NFT when it is sold.
///
///         Credits are tracked per token as a running "amount per Basket", so
///         a distribution costs the same whether 10 or 1,000 Baskets exist.
///         A Basket only earns from distributions made after it was minted.
contract BasketPot is BasketOwnable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    /// @notice Share of the free balance spent per distribution: 5%.
    uint256 public constant SPEND_BPS = 500;
    /// @notice Minimum time between distributions of the same input token.
    uint256 public constant PERIOD = 1 hours;
    uint256 public constant MAX_REWARD_TOKENS = 16;

    address public immutable nft;
    address public immutable spendToken;
    ISlipstreamRouter public immutable swapRouter;

    address public keeper;
    /// @notice Every token Baskets can be credited in. Append-only.
    address[] public rewardTokens;
    mapping(address token => bool) public isRewardToken;
    /// @notice The daily order: day N buys `rotation[N % rotation.length]`.
    address[] public rotation;

    /// @notice Running amount of `token` credited to each Basket.
    mapping(address token => uint256) public accPerBasket;
    /// @notice Total of `token` credited to Baskets and not yet withdrawn.
    mapping(address token => uint256) public owed;
    /// @dev The `accPerBasket` level a Basket has already been paid up to.
    mapping(uint256 tokenId => mapping(address token => uint256)) internal _paid;
    mapping(address tokenIn => uint256) public lastDistribution;

    error NotKeeper();
    error NotNft();
    error NotBasketHolder();
    error TooSoon(uint256 nextAt);
    error NoBaskets();
    error NothingToDistribute();
    error InvalidRewardToken();
    error TooManyRewardTokens();
    error Slippage();

    event KeeperUpdated(address keeper);
    event RewardTokenAdded(address indexed token);
    event RotationUpdated(address[] rotation);
    event Distributed(
        address indexed tokenIn, address indexed tokenOut, uint256 spent, uint256 bought, uint256 perBasket, uint256 baskets
    );
    event Withdrawn(uint256 indexed tokenId, address indexed token, address indexed to, uint256 amount);

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(address owner_, address nft_, address spendToken_, ISlipstreamRouter swapRouter_, address keeper_)
        BasketOwnable(owner_)
    {
        if (nft_ == address(0) || spendToken_ == address(0) || address(swapRouter_) == address(0) || keeper_ == address(0))
        {
            revert ZeroAddress();
        }
        nft = nft_;
        spendToken = spendToken_;
        swapRouter = swapRouter_;
        keeper = keeper_;
        _addRewardToken(spendToken_);
        rotation.push(spendToken_);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setKeeper(address keeper_) external onlyOwner {
        if (keeper_ == address(0)) revert ZeroAddress();
        keeper = keeper_;
        emit KeeperUpdated(keeper_);
    }

    function addRewardToken(address token) external onlyOwner {
        _addRewardToken(token);
    }

    function _addRewardToken(address token) private {
        if (token == address(0) || token.code.length == 0 || isRewardToken[token]) revert InvalidRewardToken();
        if (rewardTokens.length >= MAX_REWARD_TOKENS) revert TooManyRewardTokens();
        isRewardToken[token] = true;
        rewardTokens.push(token);
        emit RewardTokenAdded(token);
    }

    /// @notice Set the daily rotation. Every entry must be a reward token.
    function setRotation(address[] calldata rotation_) external onlyOwner {
        if (rotation_.length == 0) revert InvalidRewardToken();
        for (uint256 i = 0; i < rotation_.length; i++) {
            if (!isRewardToken[rotation_[i]]) revert InvalidRewardToken();
        }
        rotation = rotation_;
        emit RotationUpdated(rotation_);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function rewardTokenCount() external view returns (uint256) {
        return rewardTokens.length;
    }

    function rotationLength() external view returns (uint256) {
        return rotation.length;
    }

    /// @notice The token today's distributions buy.
    function todaysToken() public view returns (address) {
        return rotation[(block.timestamp / 1 days) % rotation.length];
    }

    /// @notice `token` held here that is not yet credited to any Basket.
    function freeBalance(address token) public view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 o = owed[token];
        return bal > o ? bal - o : 0;
    }

    /// @notice What Basket `tokenId` can withdraw of `token` right now.
    function pending(uint256 tokenId, address token) public view returns (uint256) {
        return accPerBasket[token] - _paid[tokenId][token];
    }

    // ---------------------------------------------------------------------
    // Mint hook
    // ---------------------------------------------------------------------

    /// @dev Called by the NFT on mint so a new Basket starts from the current
    ///      level and earns nothing from earlier distributions.
    function onMint(uint256 tokenId) external {
        if (msg.sender != nft) revert NotNft();
        uint256 n = rewardTokens.length;
        for (uint256 i = 0; i < n; i++) {
            address t = rewardTokens[i];
            uint256 acc = accPerBasket[t];
            if (acc != 0) _paid[tokenId][t] = acc;
        }
    }

    // ---------------------------------------------------------------------
    // Keeper: hourly distribution
    // ---------------------------------------------------------------------

    /// @notice Spend 5% of the pot's free spend-token balance on today's token
    ///         and credit it equally to every Basket. `path` is the swap route
    ///         (ignored when today's token is the spend token itself).
    function distribute(bytes calldata path, uint256 minOut) external onlyKeeper nonReentrant returns (uint256 bought) {
        address tokenOut = todaysToken();
        uint256 spend = _startRound(spendToken);

        if (tokenOut == spendToken) {
            bought = spend;
        } else {
            SwapPath.requireEndpoints(path, spendToken, tokenOut);
            uint256 before = IERC20(tokenOut).balanceOf(address(this));
            IERC20(spendToken).forceApprove(address(swapRouter), spend);
            swapRouter.exactInput(
                ISlipstreamRouter.ExactInputParams({
                    path: path,
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: spend,
                    amountOutMinimum: minOut
                })
            );
            IERC20(spendToken).forceApprove(address(swapRouter), 0);
            bought = IERC20(tokenOut).balanceOf(address(this)) - before;
        }
        if (bought < minOut) revert Slippage();
        _credit(spendToken, tokenOut, spend, bought);
    }

    /// @notice Credit 5% of a reward token the pot already holds (for example
    ///         stock tokens received as protocol fees from stock-paired coins)
    ///         straight to the Baskets, with no swap.
    function distributeHeld(address token) external onlyKeeper nonReentrant returns (uint256 amount) {
        if (!isRewardToken[token] || token == spendToken) revert InvalidRewardToken();
        amount = _startRound(token);
        _credit(token, token, amount, amount);
    }

    function _startRound(address tokenIn) private returns (uint256 spend) {
        uint256 nextAt = lastDistribution[tokenIn] + PERIOD;
        if (block.timestamp < nextAt) revert TooSoon(nextAt);
        spend = (freeBalance(tokenIn) * SPEND_BPS) / BPS;
        if (spend == 0) revert NothingToDistribute();
        lastDistribution[tokenIn] = block.timestamp;
    }

    function _credit(address tokenIn, address tokenOut, uint256 spent, uint256 bought) private {
        uint256 baskets = IBasketSupply(nft).totalSupply();
        if (baskets == 0) revert NoBaskets();
        // Whole units per Basket; the remainder stays in the free balance.
        uint256 perBasket = bought / baskets;
        if (perBasket == 0) revert NothingToDistribute();
        accPerBasket[tokenOut] += perBasket;
        owed[tokenOut] += perBasket * baskets;
        emit Distributed(tokenIn, tokenOut, spent, bought, perBasket, baskets);
    }

    // ---------------------------------------------------------------------
    // Basket holders
    // ---------------------------------------------------------------------

    /// @notice Withdraw a Basket's credit in each of `tokens`. Only the wallet
    ///         holding the NFT can call, and the tokens go to that wallet.
    function withdraw(uint256 tokenId, address[] calldata tokens) external nonReentrant {
        if (IERC721(nft).ownerOf(tokenId) != msg.sender) revert NotBasketHolder();
        for (uint256 i = 0; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 amount = pending(tokenId, t);
            if (amount == 0) continue;
            _paid[tokenId][t] = accPerBasket[t];
            owed[t] -= amount;
            IERC20(t).safeTransfer(msg.sender, amount);
            emit Withdrawn(tokenId, t, msg.sender, amount);
        }
    }
}
