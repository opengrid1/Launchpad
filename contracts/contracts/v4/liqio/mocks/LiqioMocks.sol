// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Stands in for HyperCore's oracle price precompile in tests: its runtime code is placed at 0x…0807 with
///      hardhat_setCode, and prices are set through `set` at that address.
contract MockHyperCore {
    mapping(uint32 => uint64) public px;

    function set(uint32 index, uint64 value) external {
        px[index] = value;
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        uint32 index = abi.decode(data, (uint32));
        uint64 v = px[index];
        require(v != 0, "no market");
        return abi.encode(v);
    }
}

/// @dev An ERC-20 with any decimals, free to mint.
contract LiqioMockERC20 is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, string memory s, uint8 dec) ERC20(n, s) {
        _dec = dec;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Looks like a wrapped xStock on HyperEVM: an ERC-4626-style share whose value in the underlying drifts
///      above one.
contract MockWrappedXStock is LiqioMockERC20 {
    uint256 public ratioE18 = 1e18;
    address public asset;

    constructor(string memory n, string memory s, address asset_) LiqioMockERC20(n, s, 18) {
        asset = asset_;
    }

    function setRatio(uint256 r) external {
        ratioE18 = r;
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        return (shares * ratioE18) / 1e18;
    }
}

interface ICpCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
    function algebraSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

/// @dev A constant-product pool with the swap surface of a Uniswap V3 pool (callback `uniswapV3SwapCallback`)
///      or an Algebra pool (callback `algebraSwapCallback`), which is what PRJX and KittenSwap speak on
///      HyperEVM. Exact-input only, no fee. Reserves are its balances; seed it with transfers.
contract MockCpPool {
    address public immutable token0;
    address public immutable token1;
    bool public immutable algebra;

    constructor(address a, address b, bool algebra_) {
        (token0, token1) = a < b ? (a, b) : (b, a);
        algebra = algebra_;
    }

    function slot0() external pure returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (1 << 96, 0, 0, 0, 0, 0, true);
    }

    function globalState() external pure returns (uint160, int24, uint16, uint8, uint16, bool) {
        return (1 << 96, 0, 0, 0, 0, true);
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        require(amountSpecified > 0, "exact in only");
        uint256 amountIn = uint256(amountSpecified);
        (address tin, address tout) = zeroForOne ? (token0, token1) : (token1, token0);
        uint256 rin = IERC20(tin).balanceOf(address(this));
        uint256 rout = IERC20(tout).balanceOf(address(this));
        uint256 out = (rout * amountIn) / (rin + amountIn);
        IERC20(tout).transfer(recipient, out);
        (amount0, amount1) = zeroForOne ? (int256(amountIn), -int256(out)) : (-int256(out), int256(amountIn));
        if (algebra) ICpCallback(msg.sender).algebraSwapCallback(amount0, amount1, data);
        else ICpCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        require(IERC20(tin).balanceOf(address(this)) >= rin + amountIn, "not paid");
    }
}
