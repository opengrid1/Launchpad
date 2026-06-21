// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HyperCore} from "./HyperCore.sol";

/// @title SpcxdToken — fixed-supply ERC20 whose holders earn SPCXD (SpaceX dStock) on HyperCore.
/// @notice 0% transfer tax. The 1% pool fee is harvested by the manager, used to buy SPCXD on the
///         HyperCore order book, and booked here. Holders `claimSpcxd()` and the SPCXD is sent
///         straight to their HyperCore spot account (EVM address == Core address) via a CoreWriter
///         spot-send, so they can sell it on the order book immediately — no bridging.
/// @dev Magnified-dividend-per-share accumulator denominated in SPCXD core units (8 decimals).
///      Core-native: the SPCXD reward reserve lives on THIS contract's HyperCore spot account.
contract SpcxdToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    address public owner;
    address public manager;
    uint64 public immutable spcxdCoreId; // SPCXD HyperCore token id (610)
    mapping(address => bool) public isExcluded;

    uint256 internal constant MAGNITUDE = 2 ** 128;
    uint256 public magSpcxdPerShare; // per share, in SPCXD core units (8-dec)
    uint256 public totalShares;
    uint256 internal buffered;

    mapping(address => uint256) public shares;
    mapping(address => int256) internal correction;
    mapping(address => uint256) public withdrawnSpcxd;

    event RewardBooked(uint64 spcxdCoreAmount);
    event SpcxdClaimed(address indexed account, uint64 spcxdCoreAmount);
    event ExcludedSet(address indexed account, bool excluded);

    uint256 private _locked = 1;

    modifier nonReentrant() {
        require(_locked == 1, "reentrancy");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(string memory n, string memory s, uint256 supply_, uint64 spcxdCoreId_, address mintTo) {
        require(supply_ > 0 && mintTo != address(0), "bad init");
        name = n;
        symbol = s;
        totalSupply = supply_;
        spcxdCoreId = spcxdCoreId_;
        owner = msg.sender;
        _setExcluded(address(this), true);
        _setExcluded(mintTo, true);
        balanceOf[mintTo] = supply_;
        emit Transfer(address(0), mintTo, supply_);
    }

    // ------------------------------------------------------------ ERC20
    function approve(address sp, uint256 v) external returns (bool) {
        allowance[msg.sender][sp] = v;
        emit Approval(msg.sender, sp, v);
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        _transfer(msg.sender, to, v);
        return true;
    }

    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        uint256 a = allowance[f][msg.sender];
        if (a != type(uint256).max) {
            require(a >= v, "allowance");
            allowance[f][msg.sender] = a - v;
        }
        _transfer(f, to, v);
        return true;
    }

    function _transfer(address f, address to, uint256 v) internal {
        require(to != address(0), "to zero");
        uint256 b = balanceOf[f];
        require(b >= v, "balance");
        balanceOf[f] = b - v;
        balanceOf[to] += v;
        emit Transfer(f, to, v);
        _updateShares(f);
        _updateShares(to);
    }

    function _updateShares(address a) internal {
        uint256 ns = isExcluded[a] ? 0 : balanceOf[a];
        uint256 old = shares[a];
        if (ns == old) return;
        if (ns > old) {
            uint256 d = ns - old;
            correction[a] -= int256(magSpcxdPerShare * d);
            totalShares += d;
        } else {
            uint256 d = old - ns;
            correction[a] += int256(magSpcxdPerShare * d);
            totalShares -= d;
        }
        shares[a] = ns;
    }

    // ------------------------------------------------------------ rewards
    /// @notice Book `amount` SPCXD (core units, already credited to this contract's Core account
    ///         by the manager) to holders. Manager only.
    function notifyReward(uint64 amount) external {
        require(msg.sender == manager, "not manager");
        if (totalShares == 0) {
            buffered += amount;
            emit RewardBooked(amount);
            return;
        }
        uint256 a = uint256(amount) + buffered;
        buffered = 0;
        magSpcxdPerShare += (a * MAGNITUDE) / totalShares;
        emit RewardBooked(amount);
    }

    function withdrawableSpcxd(address a) public view returns (uint256) {
        int256 t = int256(magSpcxdPerShare * shares[a]) + correction[a];
        if (t < 0) t = 0;
        return uint256(t) / MAGNITUDE - withdrawnSpcxd[a];
    }

    /// @notice Claim accrued SPCXD straight to your HyperCore spot account (async; lands a block
    ///         or two later). From there, sell it on the order book.
    function claimSpcxd() external nonReentrant returns (uint64 amount) {
        uint256 owed = withdrawableSpcxd(msg.sender);
        require(owed > 0, "nothing");
        require(owed <= type(uint64).max, "overflow");
        withdrawnSpcxd[msg.sender] += owed;
        amount = uint64(owed);
        HyperCore.spotSend(msg.sender, spcxdCoreId, amount);
        emit SpcxdClaimed(msg.sender, amount);
    }

    /// @notice This contract's SPCXD balance on HyperCore (backs unclaimed rewards).
    function spcxdOnCore() external view returns (uint64) {
        return HyperCore.spotBalance(address(this), spcxdCoreId);
    }

    // ------------------------------------------------------------ admin
    function setManager(address m) external {
        require(msg.sender == owner, "not owner");
        manager = m;
    }

    function setExcluded(address a, bool e) external {
        require(msg.sender == owner, "not owner");
        _setExcluded(a, e);
        _updateShares(a);
    }

    function _setExcluded(address a, bool e) internal {
        if (isExcluded[a] == e) return;
        isExcluded[a] = e;
        emit ExcludedSet(a, e);
    }

    function transferOwnership(address next) external {
        require(msg.sender == owner, "not owner");
        owner = next;
    }
}
