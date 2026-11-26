// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IPadAmmFactory {
    function feeTo() external view returns (address);
    function lpFeeBps() external view returns (uint16);
    function protocolFeeBps() external view returns (uint16);
}

/**
 * @title PadAmmPair
 * @notice One constant-product pool of two ERC-20s, and the ERC-20 that represents a share of it. Liquidity
 * providers add both tokens and mint shares; traders swap against the reserves and pay a fee on what they put in:
 * the LP part stays in the reserves (so every share is worth a little more after each trade), the protocol part
 * goes to the factory's `feeTo` (the fee splitter) in the token paid. No flash swaps, no callbacks. Reserves are
 * measured from balances, so a token that charges on transfer still trades correctly (the pool simply sees less).
 */
contract PadAmmPair {
    using SafeERC20 for IERC20;

    error Locked();
    error NotFactory();
    error InsufficientLiquidityMinted();
    error InsufficientLiquidityBurned();
    error InsufficientOutput();
    error InsufficientLiquidity();
    error InsufficientInput();
    error InvalidTo();
    error K();
    error Overflow();

    event Mint(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to);
    event Sync(uint112 reserve0, uint112 reserve1);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant BPS = 10_000;

    // ---- the share token
    string public constant name = "Pad LP";
    string public constant symbol = "PAD-LP";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public immutable factory;
    address public token0;
    address public token1;
    uint112 private _reserve0;
    uint112 private _reserve1;
    uint32 private _blockTimestampLast;
    uint256 private _unlocked = 1;

    modifier lock() {
        if (_unlocked != 1) revert Locked();
        _unlocked = 0;
        _;
        _unlocked = 1;
    }

    constructor() {
        factory = msg.sender;
    }

    /// @dev Called once by the factory right after deployment.
    function initialize(address _token0, address _token1) external {
        if (msg.sender != factory) revert NotFactory();
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves() public view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) {
        return (_reserve0, _reserve1, _blockTimestampLast);
    }

    // ---- ERC-20 ----------------------------------------------------------------------------------------------------

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
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) private {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) private {
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }

    // ---- pool -------------------------------------------------------------------------------------------------------

    function _update(uint256 balance0, uint256 balance1) private {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert Overflow();
        _reserve0 = uint112(balance0);
        _reserve1 = uint112(balance1);
        _blockTimestampLast = uint32(block.timestamp);
        emit Sync(_reserve0, _reserve1);
    }

    /// @notice Mints shares for the tokens sent to the pool since the last sync. Called through the router.
    function mint(address to) external lock returns (uint256 liquidity) {
        (uint112 r0, uint112 r1,) = getReserves();
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - r0;
        uint256 amount1 = balance1 - r1;
        uint256 supply = totalSupply;
        if (supply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(DEAD, MINIMUM_LIQUIDITY); // the first shares are locked forever, so the pool can never be emptied to zero
        } else {
            liquidity = Math.min((amount0 * supply) / r0, (amount1 * supply) / r1);
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();
        _mint(to, liquidity);
        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1, to);
    }

    /// @notice Burns the shares sent to the pool and pays `to` its part of both reserves. Called through the router.
    function burn(address to) external lock returns (uint256 amount0, uint256 amount1) {
        address t0 = token0;
        address t1 = token1;
        uint256 balance0 = IERC20(t0).balanceOf(address(this));
        uint256 balance1 = IERC20(t1).balanceOf(address(this));
        uint256 liquidity = balanceOf[address(this)];
        uint256 supply = totalSupply;
        amount0 = (liquidity * balance0) / supply;
        amount1 = (liquidity * balance1) / supply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidityBurned();
        _burn(address(this), liquidity);
        IERC20(t0).safeTransfer(to, amount0);
        IERC20(t1).safeTransfer(to, amount1);
        _update(IERC20(t0).balanceOf(address(this)), IERC20(t1).balanceOf(address(this)));
        emit Burn(msg.sender, amount0, amount1, to);
    }

    /// @notice Pays `amount0Out` / `amount1Out` to `to` against what was sent in since the last sync. The caller
    ///         (the router) sizes the output with the factory's total fee; the pool checks the invariant after taking
    ///         the protocol's part of the input out to `feeTo` and leaving the LP part in the reserves.
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external lock {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutput();
        (uint112 r0, uint112 r1,) = getReserves();
        if (amount0Out >= r0 || amount1Out >= r1) revert InsufficientLiquidity();
        address t0 = token0;
        address t1 = token1;
        if (to == t0 || to == t1) revert InvalidTo();
        if (amount0Out > 0) IERC20(t0).safeTransfer(to, amount0Out);
        if (amount1Out > 0) IERC20(t1).safeTransfer(to, amount1Out);
        uint256 balance0 = IERC20(t0).balanceOf(address(this));
        uint256 balance1 = IERC20(t1).balanceOf(address(this));
        uint256 amount0In = balance0 > r0 - amount0Out ? balance0 - (r0 - amount0Out) : 0;
        uint256 amount1In = balance1 > r1 - amount1Out ? balance1 - (r1 - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert InsufficientInput();
        // the protocol's part of the input, in the token paid
        (address feeTo, uint256 lpBps, uint256 pBps) = _fees();
        if (feeTo != address(0) && pBps != 0) {
            uint256 fee0 = (amount0In * pBps) / BPS;
            uint256 fee1 = (amount1In * pBps) / BPS;
            if (fee0 != 0) { IERC20(t0).safeTransfer(feeTo, fee0); balance0 -= fee0; }
            if (fee1 != 0) { IERC20(t1).safeTransfer(feeTo, fee1); balance1 -= fee1; }
        }
        {
            uint256 adjusted0 = balance0 * BPS - amount0In * lpBps;
            uint256 adjusted1 = balance1 * BPS - amount1In * lpBps;
            if (adjusted0 * adjusted1 < uint256(r0) * uint256(r1) * BPS * BPS) revert K();
        }
        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /// @notice Sends any balance above the reserves to `to`.
    function skim(address to) external lock {
        IERC20(token0).safeTransfer(to, IERC20(token0).balanceOf(address(this)) - _reserve0);
        IERC20(token1).safeTransfer(to, IERC20(token1).balanceOf(address(this)) - _reserve1);
    }

    /// @notice Sets the reserves to the balances.
    function sync() external lock {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }

    function _fees() private view returns (address feeTo, uint256 lpBps, uint256 pBps) {
        IPadAmmFactory f = IPadAmmFactory(factory);
        return (f.feeTo(), f.lpFeeBps(), f.protocolFeeBps());
    }
}
