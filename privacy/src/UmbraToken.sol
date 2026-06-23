// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title UmbraToken (UMBRA)
/// @notice Governance and reward token for the Umbra privacy protocol.
/// Supply is capped. An initial allocation is minted at deploy (for the
/// presale, liquidity and treasury); the remainder up to the cap can only be
/// minted by a single `minter` (the anonymity-mining contract) as deposit
/// rewards. The owner can set the minter once mining is ready and then renounce.
contract UmbraToken {
    string public constant name = "Umbra";
    string public constant symbol = "UMBRA";
    uint8 public constant decimals = 18;

    uint256 public immutable maxSupply;
    uint256 public totalSupply;

    address public owner;
    address public minter;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterSet(address indexed minter);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// @param maxSupply_ hard cap on total supply
    /// @param initialRecipient receives the initial mint (presale + liquidity + treasury)
    /// @param initialAmount size of the initial mint, must be <= cap
    /// @param owner_ can set the minter and transfer ownership
    constructor(uint256 maxSupply_, address initialRecipient, uint256 initialAmount, address owner_) {
        require(maxSupply_ > 0, "zero cap");
        require(initialAmount <= maxSupply_, "initial over cap");
        require(initialRecipient != address(0) && owner_ != address(0), "zero addr");

        maxSupply = maxSupply_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);

        if (initialAmount > 0) {
            totalSupply = initialAmount;
            balanceOf[initialRecipient] = initialAmount;
            emit Transfer(address(0), initialRecipient, initialAmount);
        }
    }

    /// @notice Mint reward tokens, only callable by the mining contract, never past the cap.
    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "not minter");
        require(to != address(0), "zero addr");
        require(totalSupply + amount <= maxSupply, "exceeds cap");
        totalSupply += amount;
        unchecked {
            balanceOf[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }

    function setMinter(address minter_) external onlyOwner {
        minter = minter_;
        emit MinterSet(minter_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        return _transfer(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "insufficient allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        return _transfer(from, to, value);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal returns (bool) {
        require(to != address(0), "transfer to zero");
        uint256 bal = balanceOf[from];
        require(bal >= value, "insufficient balance");
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
        return true;
    }
}
