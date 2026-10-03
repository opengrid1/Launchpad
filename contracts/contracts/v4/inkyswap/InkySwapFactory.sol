// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.26;

import {InkySwapPair} from "./InkySwapPair.sol";

/// @title InkySwapFactory
/// @notice Creates one constant-product pair per token pair (CREATE2, so the
///         address is a pure function of the two tokens). `feeTo` receives the
///         protocol share of swap fees as LP tokens; the fee collector turns
///         that into ETH for $INKY stakers.
contract InkySwapFactory {
    address public feeTo;
    address public feeToSetter;
    /// @notice 1/denominator of the fee growth goes to feeTo. 6 = 1/6 of the 0.3% fee = 0.05% of volume.
    uint256 public protocolFeeDenominator = 6;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);
    event FeeToSet(address feeTo);
    event FeeToSetterSet(address feeToSetter);
    event ProtocolFeeDenominatorSet(uint256 denominator);

    error IdenticalAddresses();
    error ZeroAddress();
    error PairExists();
    error Forbidden();
    error InvalidDenominator();

    constructor(address _feeToSetter) {
        if (_feeToSetter == address(0)) revert ZeroAddress();
        feeToSetter = _feeToSetter;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @notice keccak256 of the pair creation code, for off-chain address derivation.
    function pairCodeHash() external pure returns (bytes32) {
        return keccak256(type(InkySwapPair).creationCode);
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
        if (getPair[token0][token1] != address(0)) revert PairExists();
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        pair = address(new InkySwapPair{salt: salt}());
        InkySwapPair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external {
        if (msg.sender != feeToSetter) revert Forbidden();
        feeTo = _feeTo;
        emit FeeToSet(_feeTo);
    }

    function setFeeToSetter(address _feeToSetter) external {
        if (msg.sender != feeToSetter) revert Forbidden();
        if (_feeToSetter == address(0)) revert ZeroAddress();
        feeToSetter = _feeToSetter;
        emit FeeToSetterSet(_feeToSetter);
    }

    /// @notice 2 = half of the fee to the protocol, 6 = a sixth (Uniswap V2 default), larger = less.
    function setProtocolFeeDenominator(uint256 denominator) external {
        if (msg.sender != feeToSetter) revert Forbidden();
        if (denominator < 2 || denominator > 100) revert InvalidDenominator();
        protocolFeeDenominator = denominator;
        emit ProtocolFeeDenominatorSet(denominator);
    }
}
