// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {PadAmmPair} from "./PadAmmPair.sol";

/**
 * @title PadAmmFactory
 * @notice Creates one PadAmmPair per unordered token pair (CREATE2, so a pair's address follows from its tokens) and
 * holds the fee terms every pair reads at swap time: the LP fee that stays with the liquidity providers and the
 * protocol fee that goes to `feeTo` (the fee splitter). The owner tunes both within a 1% total.
 */
contract PadAmmFactory is Ownable2Step {
    error IdenticalTokens();
    error ZeroAddress();
    error PairExists();
    error FeeTooHigh();
    error OwnershipCannotBeRenounced();

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 index);
    event FeesSet(uint16 lpFeeBps, uint16 protocolFeeBps);
    event FeeToSet(address feeTo);

    uint256 public constant MAX_TOTAL_FEE_BPS = 100;
    bytes32 public immutable PAIR_INIT_CODE_HASH = keccak256(type(PadAmmPair).creationCode);

    address public feeTo;
    uint16 public lpFeeBps;
    uint16 public protocolFeeBps;
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    constructor(address initialOwner, address feeTo_, uint16 lpFeeBps_, uint16 protocolFeeBps_) Ownable(initialOwner) {
        if (uint256(lpFeeBps_) + protocolFeeBps_ > MAX_TOTAL_FEE_BPS) revert FeeTooHigh();
        feeTo = feeTo_;
        lpFeeBps = lpFeeBps_;
        protocolFeeBps = protocolFeeBps_;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @notice Anyone can open a pool for any two tokens.
    function createPair(address tokenA, address tokenB) external returns (address pair) {
        if (tokenA == tokenB) revert IdenticalTokens();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
        if (getPair[token0][token1] != address(0)) revert PairExists();
        pair = address(new PadAmmPair{salt: keccak256(abi.encodePacked(token0, token1))}());
        PadAmmPair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    function setFees(uint16 lpFeeBps_, uint16 protocolFeeBps_) external onlyOwner {
        if (uint256(lpFeeBps_) + protocolFeeBps_ > MAX_TOTAL_FEE_BPS) revert FeeTooHigh();
        lpFeeBps = lpFeeBps_;
        protocolFeeBps = protocolFeeBps_;
        emit FeesSet(lpFeeBps_, protocolFeeBps_);
    }

    /// @notice Where the protocol fee goes; address zero turns it off.
    function setFeeTo(address feeTo_) external onlyOwner {
        feeTo = feeTo_;
        emit FeeToSet(feeTo_);
    }
}
