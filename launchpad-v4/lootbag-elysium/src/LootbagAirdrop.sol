// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20A {
    function transfer(address to, uint256 v) external returns (bool);
    function approve(address s, uint256 v) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

interface ISwapperA {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256);
}

/// @title LootbagAirdrop
/// @notice The trader airdrop pot. 10% of Lootbag's fee income lands here. Every 10 hours a keeper posts a round: the
///         list of the top 500 traders by volume on Lootbag coins and what each gets, as a Merkle root, with the full
///         list published so anyone can check it. The pot pays it in KNTQ, pushed straight to the wallets (anyone can
///         push a payment with its proof, and a trader can claim their own). A round can pay out at most the pot.
///         Payments not made within 30 days go back to the pot.
/// @dev Who traded what is computed off-chain from the hook's swap events, so the keeper is trusted to post the
///      right list; the list and the code that makes it are public, and the contract caps every round at the pot.
contract LootbagAirdrop {
    error NotOwner();
    error NotKeeper();
    error TooSoon();
    error OverPot();
    error BadProof();
    error AlreadyPaid();
    error NotExpired();
    error BadToken();
    error RoundExpired();

    event Posted(uint256 indexed round, bytes32 root, uint256 total, string listUri);
    event Paid(uint256 indexed round, address indexed account, uint256 amount);
    event Expired(uint256 indexed round, uint256 returned);
    event Converted(address indexed token, uint256 amountIn, uint256 kntqOut);

    uint256 public constant EVERY = 10 hours;
    uint256 public constant EXPIRY = 30 days;

    address public immutable kntq;
    ISwapperA public immutable swapper;
    address public owner;
    address public pendingOwner;
    mapping(address => bool) public keeper;

    struct Round {
        bytes32 root;
        uint128 total;
        uint128 paid;
        uint64 postedAt;
        bool expired;
    }

    Round[] public rounds;
    /// @notice KNTQ set aside for posted rounds and not yet paid
    uint256 public reserved;
    mapping(uint256 => mapping(address => bool)) public paidOut;

    constructor(address kntq_, address swapper_, address owner_) {
        kntq = kntq_;
        swapper = ISwapperA(swapper_);
        owner = owner_;
    }

    function setKeeper(address k, bool on) external {
        if (msg.sender != owner) revert NotOwner();
        keeper[k] = on;
    }

    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotOwner();
        pendingOwner = to;
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @notice the KNTQ the next round can pay out
    function pot() public view returns (uint256) {
        return IERC20A(kntq).balanceOf(address(this)) - reserved;
    }

    function roundCount() external view returns (uint256) {
        return rounds.length;
    }

    function nextRoundAt() external view returns (uint256) {
        return rounds.length == 0 ? 0 : rounds[rounds.length - 1].postedAt + EVERY;
    }

    /// @notice Posts a round: a Merkle root of (account, amount) and its total, at most the pot
    function post(bytes32 root, uint256 total, string calldata listUri) external returns (uint256 id) {
        if (!keeper[msg.sender]) revert NotKeeper();
        if (rounds.length != 0 && block.timestamp < rounds[rounds.length - 1].postedAt + EVERY) revert TooSoon();
        if (total > pot()) revert OverPot();
        reserved += total;
        id = rounds.length;
        rounds.push(Round(root, uint128(total), 0, uint64(block.timestamp), false));
        emit Posted(id, root, total, listUri);
    }

    /// @notice Pays `account` its share of round `id`. Anyone can call (keepers push every payment this way).
    function pay(uint256 id, address account, uint256 amount, bytes32[] calldata proof) public {
        Round storage r = rounds[id];
        if (r.expired) revert RoundExpired();
        if (paidOut[id][account]) revert AlreadyPaid();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!_verify(proof, r.root, leaf)) revert BadProof();
        paidOut[id][account] = true;
        r.paid += uint128(amount);
        reserved -= amount;
        require(IERC20A(kntq).transfer(account, amount), "pay");
        emit Paid(id, account, amount);
    }

    function payMany(uint256 id, address[] calldata accounts, uint256[] calldata amounts, bytes32[][] calldata proofs)
        external
    {
        for (uint256 i; i < accounts.length; i++) if (!paidOut[id][accounts[i]]) pay(id, accounts[i], amounts[i], proofs[i]);
    }

    /// @notice After 30 days a round's unpaid part goes back to the pot
    function expire(uint256 id) external {
        Round storage r = rounds[id];
        if (r.expired || block.timestamp < r.postedAt + EXPIRY) revert NotExpired();
        r.expired = true;
        uint256 left = r.total - r.paid;
        reserved -= left;
        emit Expired(id, left);
    }

    /// @notice Turns fee income that arrived in another currency into KNTQ. Keepers only (the swap needs a minimum).
    function convert(address token, uint256 minOut) external returns (uint256 out) {
        if (!keeper[msg.sender]) revert NotKeeper();
        if (token == kntq) revert BadToken();
        uint256 amt = IERC20A(token).balanceOf(address(this));
        if (amt == 0) return 0;
        IERC20A(token).approve(address(swapper), amt);
        out = swapper.swap(token, kntq, amt, minOut, address(this));
        emit Converted(token, amt, out);
    }

    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 h = leaf;
        for (uint256 i; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h < p ? keccak256(abi.encode(h, p)) : keccak256(abi.encode(p, h));
        }
        return h == root;
    }
}
