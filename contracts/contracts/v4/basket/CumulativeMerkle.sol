// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CumulativeMerkle
/// @notice Single-root cumulative Merkle payout. Each leaf is
///         `(account, cumulativeAmount)`: everything that account has ever been
///         allotted. A new root replaces the old one, and a claim pays the
///         difference between the leaf and what the account already took, so a
///         holder claims once no matter how many rounds they missed.
///
///         Leaves use the OpenZeppelin StandardMerkleTree encoding for
///         `["address", "uint256"]`.
abstract contract CumulativeMerkle is ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public merkleRoot;
    /// @notice Sum of every leaf in the current root.
    uint256 public committed;
    /// @notice Total paid out so far.
    uint256 public claimedTotal;
    uint64 public rootCount;
    mapping(address account => uint256) public claimedOf;

    error BadProof();
    error NothingToClaim();
    error Overallocated();
    error CommittedCannotDecrease();

    event RootPosted(uint64 indexed round, bytes32 root, uint256 committed);
    event Claimed(address indexed account, uint256 amount, uint256 cumulativeAmount);

    /// @dev The token this distributor pays out.
    function payoutToken() public view virtual returns (IERC20);

    /// @notice Payout token held here that no posted root has allotted yet.
    function distributable() public view returns (uint256) {
        uint256 bal = payoutToken().balanceOf(address(this));
        uint256 owed = committed - claimedTotal;
        return bal > owed ? bal - owed : 0;
    }

    /// @dev `newCommitted` is the sum of all leaves in `root`. It can only
    ///      grow, and the unclaimed part must already be in this contract, so a
    ///      root can never promise more than the contract holds.
    function _postRoot(bytes32 root, uint256 newCommitted) internal {
        if (newCommitted < committed) revert CommittedCannotDecrease();
        if (newCommitted - claimedTotal > payoutToken().balanceOf(address(this))) revert Overallocated();
        merkleRoot = root;
        committed = newCommitted;
        emit RootPosted(++rootCount, root, newCommitted);
    }

    /// @notice Pay `account` whatever its leaf allots beyond what it has taken.
    ///         Anyone can submit the proof; the funds only go to `account`.
    function claim(address account, uint256 cumulativeAmount, bytes32[] calldata proof) external nonReentrant {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, cumulativeAmount))));
        if (!MerkleProof.verifyCalldata(proof, merkleRoot, leaf)) revert BadProof();
        uint256 already = claimedOf[account];
        if (cumulativeAmount <= already) revert NothingToClaim();
        uint256 pay = cumulativeAmount - already;
        claimedOf[account] = cumulativeAmount;
        claimedTotal += pay;
        if (claimedTotal > committed) revert Overallocated();
        payoutToken().safeTransfer(account, pay);
        emit Claimed(account, pay, cumulativeAmount);
    }
}
