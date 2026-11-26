// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {PositionInfo} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/**
 * @title PadLocker
 * @notice Holds the Uniswap V4 position NFT of every Pad launch: one single-sided
 * position from the opening price to the top of the range.
 * Creators and traders have no function here. The protocol owner keeps
 * `collect`, which takes a share (up to all) of a launch's liquidity out of its
 * position and sends the withdrawn token and HYPE to a
 * recipient, with the same signature and behaviour as OneHook's factory
 * `collect`. Every call emits `Collected`.
 * @dev Positions accrue no LP fees (the pools charge an LP fee of zero; the
 * hook takes every fee), so a decrease returns principal only.
 */
contract PadLocker is Ownable2Step, ReentrancyGuard {
    error NotFactory();
    error AlreadyInitialized();
    error ZeroAddress();
    error PositionAlreadyLocked();
    error PositionNotHeld();
    error NotPositionManager();
    error UnknownToken();
    error InvalidParams();
    error OwnershipCannotBeRenounced();

    event FactorySet(address factory);
    event PositionLocked(address indexed token, uint256 tokenId);
    event Collected(
        address indexed token, uint16 bps, uint256 tokenAmount, uint256 pairAmount, address indexed recipient
    );

    uint256 private constant BASIS_POINTS = 10_000;

    IPositionManager public immutable positionManager;
    address public factory;

    mapping(address token => uint256 tokenId) private _positions;
    mapping(address token => bool locked) public isLocked;

    constructor(address initialOwner, IPositionManager positionManager_) Ownable(initialOwner) {
        if (address(positionManager_) == address(0)) revert ZeroAddress();
        positionManager = positionManager_;
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    /**
     * @notice One-time wiring of the factory, set after both are deployed.
     */
    function setFactory(address factory_) external onlyOwner {
        if (factory != address(0)) revert AlreadyInitialized();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    /**
     * @notice Permanently disabled, as in the base launchpad: an ownerless locker could
     * never be wired to a factory.
     */
    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    /**
     * @notice Accepts a safe transfer of a canonical position NFT only.
     * The factory mints straight to this address, which fires no callback.
     */
    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(positionManager)) revert NotPositionManager();
        return this.onERC721Received.selector;
    }

    /**
     * @notice Records custody of a launch's position, called once by the
     * factory right after it minted it to this address.
     */
    function lockPosition(address token, uint256 tokenId) external onlyFactory {
        if (isLocked[token]) revert PositionAlreadyLocked();
        if (IERC721(address(positionManager)).ownerOf(tokenId) != address(this)) revert PositionNotHeld();
        isLocked[token] = true;
        _positions[token] = tokenId;
        emit PositionLocked(token, tokenId);
    }

    function positionOf(address token) external view returns (uint256) {
        return _positions[token];
    }

    /**
     * @notice Owner only. Removes `bps` (1 to 10,000; 10,000 is all of it) of
     * the liquidity of `token`'s position and sends what comes out, in the
     * launch token and in the pair currency, to `recipient`.
     * @return tokenAmount Launch tokens `recipient` received.
     * @return pairAmount Pair currency (HYPE) `recipient` received.
     */
    function collect(address token, uint16 bps, address recipient)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokenAmount, uint256 pairAmount)
    {
        if (bps == 0 || bps > BASIS_POINTS || recipient == address(0)) revert InvalidParams();
        if (!isLocked[token]) revert UnknownToken();
        uint256 id = _positions[token];
        (PoolKey memory key,) = positionManager.getPoolAndPositionInfo(id);
        uint256 removed = (uint256(positionManager.getPositionLiquidity(id)) * bps) / BASIS_POINTS;
        if (removed == 0) revert InvalidParams();

        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(id, removed, uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, recipient);

        Currency tokenCurrency = Currency.unwrap(key.currency0) == token ? key.currency0 : key.currency1;
        Currency pairCurrency = Currency.unwrap(key.currency0) == token ? key.currency1 : key.currency0;
        uint256 tokenBefore = tokenCurrency.balanceOf(recipient);
        uint256 pairBefore = pairCurrency.balanceOf(recipient);

        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        tokenAmount = tokenCurrency.balanceOf(recipient) - tokenBefore;
        pairAmount = pairCurrency.balanceOf(recipient) - pairBefore;
        emit Collected(token, bps, tokenAmount, pairAmount, recipient);
    }
}
