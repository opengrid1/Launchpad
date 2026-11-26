// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {CumulativeMerkle} from "./CumulativeMerkle.sol";
import {ISlipstreamRouter, SwapPath} from "./ISlipstreamRouter.sol";

interface IKeeperSource {
    function keeper() external view returns (address);
}

/// @title BasketRewardVault
/// @notice Per-coin holder-reward vault: "hold the coin, earn the reward
///         token." The coin's holder share of every trade fee arrives here in
///         the pair token (the hook never charges in the coin). If the coin
///         pays a different token, such as a tokenized stock, the keeper swaps
///         the pair token into it. The keeper then snapshots holders off chain
///         and posts a cumulative Merkle root; holders claim with a proof.
///
///         What the keeper can and cannot do: it picks the swap route and the
///         minimum output, and it posts the roots. It cannot pick the tokens
///         swapped, cannot send the proceeds anywhere but this vault, and a
///         root can never allot more than the vault holds. The keeper is the
///         factory's current `keeper`, so the admin can rotate it.
contract BasketRewardVault is CumulativeMerkle {
    using SafeERC20 for IERC20;

    address public immutable factory;
    address public immutable coin;
    address public immutable pair;
    address public immutable rewardToken;
    /// @notice Swap router fixed at launch; later admin changes do not reach
    ///         a vault that already exists.
    ISlipstreamRouter public immutable swapRouter;

    error NotKeeper();
    error NothingToSwap();
    error Slippage();

    event Converted(uint256 pairIn, uint256 rewardOut);

    modifier onlyKeeper() {
        if (msg.sender != IKeeperSource(factory).keeper()) revert NotKeeper();
        _;
    }

    constructor(address factory_, address coin_, address pair_, address rewardToken_, ISlipstreamRouter swapRouter_) {
        factory = factory_;
        coin = coin_;
        pair = pair_;
        rewardToken = rewardToken_;
        swapRouter = swapRouter_;
    }

    function payoutToken() public view override returns (IERC20) {
        return IERC20(rewardToken);
    }

    function keeper() external view returns (address) {
        return IKeeperSource(factory).keeper();
    }

    /// @notice Swap `amountIn` of the pair token into the reward token along
    ///         `path`. Only meaningful when the reward token is not the pair.
    function swapToReward(bytes calldata path, uint256 amountIn, uint256 minRewardOut)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 rewardOut)
    {
        if (rewardToken == pair || amountIn == 0) revert NothingToSwap();
        SwapPath.requireEndpoints(path, pair, rewardToken);

        uint256 before = IERC20(rewardToken).balanceOf(address(this));
        IERC20(pair).forceApprove(address(swapRouter), amountIn);
        swapRouter.exactInput(
            ISlipstreamRouter.ExactInputParams({
                path: path,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: minRewardOut
            })
        );
        IERC20(pair).forceApprove(address(swapRouter), 0);

        rewardOut = IERC20(rewardToken).balanceOf(address(this)) - before;
        if (rewardOut < minRewardOut) revert Slippage();
        emit Converted(amountIn, rewardOut);
    }

    /// @notice Publish a new cumulative root. `newCommitted` is the sum of its
    ///         leaves; the unclaimed part must already be in the vault.
    function postRoot(bytes32 root, uint256 newCommitted) external onlyKeeper {
        _postRoot(root, newCommitted);
    }
}
