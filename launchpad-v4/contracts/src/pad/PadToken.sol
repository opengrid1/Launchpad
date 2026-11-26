// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title PadToken
 * @notice The token every Pad launch uses, deployed as an EIP-1167 clone
 * of one implementation. A plain fixed-supply ERC-20 with EIP-2612 permit:
 * no owner, no mint after initialization, no burn, no transfer tax, no
 * blacklist and no hooks in the transfer path.
 * @dev The factory clones and initializes in the same transaction, so there is
 * no window in which anyone else could initialize a fresh clone. Name and
 * symbol live in storage (a clone cannot carry per-token immutables), and the
 * permit domain separator is derived from them.
 */
contract PadToken {
    error AlreadyInitialized();
    error InsufficientBalance();
    error InsufficientAllowance();
    error PermitExpired();
    error InvalidSignature();
    error ZeroAddress();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 private constant VERSION_HASH = keccak256("1");

    uint8 public constant decimals = 18;

    string public name;
    string public symbol;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;

    /**
     * @notice One-time setup of a fresh clone: sets the metadata and mints the
     * whole fixed supply to `to` (the factory, which places all of it into
     * the launch pool in the same transaction).
     */
    function initialize(string calldata name_, string calldata symbol_, uint256 supply, address to) external {
        if (totalSupply != 0) revert AlreadyInitialized();
        if (to == address(0) || supply == 0) revert ZeroAddress();
        name = name_;
        symbol = symbol_;
        totalSupply = supply;
        balanceOf[to] = supply;
        emit Transfer(address(0), to, supply);
    }

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
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance();
            unchecked {
                allowance[from][msg.sender] = allowed - value;
            }
        }
        _transfer(from, to, value);
        return true;
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        if (block.timestamp > deadline) revert PermitExpired();
        // Reject malleable signatures (upper half of s), as OpenZeppelin's ECDSA does.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert InvalidSignature();
        unchecked {
            bytes32 digest = keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    DOMAIN_SEPARATOR(),
                    keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
                )
            );
            address signer = ecrecover(digest, v, r, s);
            if (signer == address(0) || signer != owner) revert InvalidSignature();
        }
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), VERSION_HASH, block.chainid, address(this)));
    }

    function _transfer(address from, address to, uint256 value) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
