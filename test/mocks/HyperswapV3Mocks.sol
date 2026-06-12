// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {
    INonfungiblePositionManager,
    ISwapRouter
} from "../../src/interfaces/IHyperswapV3.sol";

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev WETH9-style wrapped-HYPE mock.
contract MockWHYPE {
    string public constant name = "Wrapped HYPE";
    string public constant symbol = "WHYPE";
    uint8 public constant decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "WHYPE: balance");
        balanceOf[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "WHYPE: send");
        emit Transfer(msg.sender, address(0), amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "WHYPE: allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "WHYPE: balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @dev Minimal V3 pool mock: stores the init price, serves a configurable TWAP,
///      and holds the pooled assets (the mock position manager forwards them here;
///      the mock router pays swap output from here).
contract MockPool {
    address public immutable token0;
    address public immutable token1;
    uint160 public sqrtPriceX96;
    uint16 public cardinalityNext;

    int24 public twapTick;
    bool public twapAvailable; // observe() reverts until the test enables it

    constructor(address token0_, address token1_, uint160 sqrtPriceX96_) {
        token0 = token0_;
        token1 = token1_;
        sqrtPriceX96 = sqrtPriceX96_;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, 0, 0, 1, cardinalityNext, 0, true);
    }

    function increaseObservationCardinalityNext(uint16 next) external {
        cardinalityNext = next;
    }

    function setTwap(int24 tick) external {
        twapTick = tick;
        twapAvailable = true;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        require(twapAvailable, "OLD");
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
        int56 anchor = 1_000_000;
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            tickCumulatives[i] = int56(twapTick) * (anchor - int56(uint56(secondsAgos[i])));
        }
    }

    /// @dev Test-only escape hatch so the mock router can pay swap output from pool funds.
    function pay(address token, address to, uint256 amount) external {
        IERC20Minimal(token).transfer(to, amount);
    }
}

/// @dev Mock NonfungiblePositionManager: records mint params, pulls the deposited
///      tokens and forwards them to the pool, and pays out test-configured fee
///      amounts on collect() (funded by the test).
contract MockPositionManager {
    struct Minted {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0;
        uint256 amount1;
        address recipient;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Minted) public minted;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => uint256) public collectable0;
    mapping(uint256 => uint256) public collectable1;
    mapping(bytes32 => address) public pools;
    address public lastPool;

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool) {
        bytes32 key = keccak256(abi.encode(token0, token1, fee));
        require(pools[key] == address(0), "pool exists");
        pool = address(new MockPool(token0, token1, sqrtPriceX96));
        pools[key] = pool;
        lastPool = pool;
    }

    function mint(INonfungiblePositionManager.MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        tokenId = nextId++;
        address pool = pools[keccak256(abi.encode(params.token0, params.token1, params.fee))];
        require(pool != address(0), "no pool");

        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
        if (amount0 > 0) IERC20Minimal(params.token0).transferFrom(msg.sender, pool, amount0);
        if (amount1 > 0) IERC20Minimal(params.token1).transferFrom(msg.sender, pool, amount1);

        minted[tokenId] = Minted({
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            amount0: amount0,
            amount1: amount1,
            recipient: params.recipient
        });
        ownerOf[tokenId] = params.recipient;
        liquidity = uint128(amount0 + amount1);
    }

    function setCollectable(uint256 tokenId, uint256 amount0, uint256 amount1) external {
        collectable0[tokenId] = amount0;
        collectable1[tokenId] = amount1;
    }

    function collect(INonfungiblePositionManager.CollectParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1)
    {
        require(msg.sender == ownerOf[params.tokenId], "not owner");
        amount0 = collectable0[params.tokenId];
        amount1 = collectable1[params.tokenId];
        collectable0[params.tokenId] = 0;
        collectable1[params.tokenId] = 0;
        Minted storage m = minted[params.tokenId];
        if (amount0 > 0) IERC20Minimal(m.token0).transfer(params.recipient, amount0);
        if (amount1 > 0) IERC20Minimal(m.token1).transfer(params.recipient, amount1);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        require(msg.sender == from && ownerOf[tokenId] == from, "not owner");
        ownerOf[tokenId] = to;
    }
}

/// @dev Mock SwapRouter: pulls tokenIn from the caller into the pool and pays
///      tokenOut from the pool at a test-configured rate (1e18 = 1:1).
contract MockSwapRouter {
    MockPositionManager public immutable pm;
    uint256 public rate = 1e18;

    constructor(MockPositionManager pm_) {
        pm = pm_;
    }

    function setRate(uint256 rate_) external {
        rate = rate_;
    }

    function exactInputSingle(ISwapRouter.ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        (address token0, address token1) = params.tokenIn < params.tokenOut
            ? (params.tokenIn, params.tokenOut)
            : (params.tokenOut, params.tokenIn);
        address pool = pm.pools(keccak256(abi.encode(token0, token1, params.fee)));
        require(pool != address(0), "no pool");

        IERC20Minimal(params.tokenIn).transferFrom(msg.sender, pool, params.amountIn);
        amountOut = (params.amountIn * rate) / 1e18;
        require(amountOut >= params.amountOutMinimum, "Too little received");
        MockPool(pool).pay(params.tokenOut, params.recipient, amountOut);
    }
}
