// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title LoyaltyAirdrop
/// @notice Merkle-based distributor for the loyalty program. The Treasury buys a
///         hyped token with protocol fees, escrows it here, and opens a campaign
///         whose Merkle root commits to a snapshot of an older coin's holders and
///         their amounts. Holders claim on-chain — provable, fair, and permanent
///         (no discretionary "manual" airdrop). Unclaimed tokens can be swept
///         back to the treasury only after the campaign expires.
contract LoyaltyAirdrop {
    address public immutable treasury;

    struct Campaign {
        address token;
        bytes32 merkleRoot;
        uint256 total;
        uint256 claimed;
        uint64 expiry;
    }

    Campaign[] public campaigns;
    // campaignId => leaf index => claimed?
    mapping(uint256 => mapping(uint256 => bool)) public isClaimed;

    uint64 public constant CLAIM_WINDOW = 60 days;

    event CampaignCreated(uint256 indexed id, address indexed token, bytes32 root, uint256 total, uint64 expiry);
    event Claimed(uint256 indexed id, uint256 index, address indexed account, uint256 amount);
    event Swept(uint256 indexed id, uint256 amount);

    error OnlyTreasury();
    error AlreadyClaimed();
    error BadProof();
    error NotExpired();

    constructor(address _treasury) {
        treasury = _treasury;
    }

    /// Called by the Treasury after it has transferred `total` tokens in.
    function createCampaign(address token, bytes32 merkleRoot, uint256 total)
        external
        returns (uint256 id)
    {
        if (msg.sender != treasury) revert OnlyTreasury();
        id = campaigns.length;
        campaigns.push(Campaign({
            token: token,
            merkleRoot: merkleRoot,
            total: total,
            claimed: 0,
            expiry: uint64(block.timestamp) + CLAIM_WINDOW
        }));
        emit CampaignCreated(id, token, merkleRoot, total, uint64(block.timestamp) + CLAIM_WINDOW);
    }

    /// Old-coin holder claims their share. Leaf = keccak256(index, account, amount).
    function claim(uint256 id, uint256 index, address account, uint256 amount, bytes32[] calldata proof)
        external
    {
        Campaign storage c = campaigns[id];
        if (isClaimed[id][index]) revert AlreadyClaimed();

        bytes32 leaf = keccak256(abi.encodePacked(index, account, amount));
        if (!_verify(proof, c.merkleRoot, leaf)) revert BadProof();

        isClaimed[id][index] = true;
        c.claimed += amount;
        IERC20Transfer(c.token).transfer(account, amount);
        emit Claimed(id, index, account, amount);
    }

    /// After expiry, return whatever went unclaimed to the treasury.
    function sweep(uint256 id) external {
        Campaign storage c = campaigns[id];
        if (block.timestamp < c.expiry) revert NotExpired();
        uint256 left = c.total - c.claimed;
        c.claimed = c.total;
        if (left > 0) IERC20Transfer(c.token).transfer(treasury, left);
        emit Swept(id, left);
    }

    function campaignsLength() external view returns (uint256) {
        return campaigns.length;
    }

    // ── Merkle proof (sorted-pair) ────────────────────────────────────────────
    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h <= p ? keccak256(abi.encodePacked(h, p)) : keccak256(abi.encodePacked(p, h));
        }
        return h == root;
    }
}
