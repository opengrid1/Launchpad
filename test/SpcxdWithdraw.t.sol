// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SpcxdToken} from "../src/spcx/SpcxdToken.sol";
import {SpcxdManager} from "../src/spcx/SpcxdManager.sol";
import {HyperCore} from "../src/spcx/HyperCore.sol";
import {INonfungiblePositionManager, ISwapRouter, IWHYPE} from "../src/interfaces/IHyperswapV3.sol";

interface IERC20Like {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @notice Minimal WHYPE: ERC20 balances + native backing so withdraw() pays out native HYPE.
contract MockWHYPE {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function mint(address to, uint256 v) external payable {
        balanceOf[to] += v; // native backing comes from msg.value
    }

    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "wbal");
        balanceOf[msg.sender] -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "native");
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        return true;
    }

    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        balanceOf[f] -= v;
        balanceOf[to] += v;
        return true;
    }

    receive() external payable {}
}

/// @notice Minimal NFPM that holds the seeded launch token and returns principal on withdraw.
contract MockNFPM {
    address public token0;
    address public token1;
    uint128 public liquidity;
    address public whypeAddr;

    uint256 public principalToken; // launch-token principal returned on withdraw
    uint256 public principalHype; // WHYPE principal returned on withdraw

    constructor(address whype_) {
        whypeAddr = whype_;
    }

    function createAndInitializePoolIfNecessary(address t0, address t1, uint24, uint160)
        external
        returns (address)
    {
        token0 = t0;
        token1 = t1;
        return address(this);
    }

    function increaseObservationCardinalityNext(uint16) external {}

    function mint(INonfungiblePositionManager.MintParams calldata p)
        external
        returns (uint256, uint128, uint256, uint256)
    {
        // pull the single-sided launch-token supply from the manager
        uint256 want0 = p.amount0Desired;
        uint256 want1 = p.amount1Desired;
        if (want0 > 0) IERC20Like(p.token0).transferFrom(msg.sender, address(this), want0);
        if (want1 > 0) IERC20Like(p.token1).transferFrom(msg.sender, address(this), want1);
        liquidity = 1_000_000;
        return (1, liquidity, want0, want1);
    }

    function setPrincipal(uint256 tok, uint256 hype) external {
        principalToken = tok;
        principalHype = hype;
    }

    function positions(uint256)
        external
        view
        returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)
    {
        return (0, address(0), token0, token1, 0, 0, 0, liquidity, 0, 0, 0, 0);
    }

    function decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams calldata)
        external
        returns (uint256, uint256)
    {
        liquidity = 0;
        return (0, 0);
    }

    // fees path returns nothing; principal path (after decrease) returns the configured amounts
    function collect(INonfungiblePositionManager.CollectParams calldata p)
        external
        returns (uint256 a0, uint256 a1)
    {
        bool tokenIs0 = token0 != whypeAddr;
        if (liquidity != 0) return (0, 0); // fees pass: nothing owed in this mock
        uint256 tokOut = principalToken;
        uint256 hypeOut = principalHype;
        if (tokOut > 0) IERC20Like(tokenIs0 ? token0 : token1).transfer(p.recipient, tokOut);
        if (hypeOut > 0) IERC20Like(whypeAddr).transfer(p.recipient, hypeOut);
        principalToken = 0;
        principalHype = 0;
        (a0, a1) = tokenIs0 ? (tokOut, hypeOut) : (hypeOut, tokOut);
    }

    function safeTransferFrom(address, address, uint256) external {}
}

contract MockCoreWriter2 {
    function sendRawAction(bytes calldata) external {}
}

contract MockSpot2 {
    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(uint64(0), uint64(0), uint64(0));
    }
}

contract SpcxdWithdrawTest is Test {
    SpcxdToken token;
    SpcxdManager mgr;
    MockWHYPE whype;
    MockNFPM nfpm;

    uint64 constant SPCXD_ID = 610;
    uint256 constant SUPPLY = 10_000e18;
    address treasury = makeAddr("treasury");

    function setUp() public {
        whype = new MockWHYPE();
        nfpm = new MockNFPM(address(whype));
        token = new SpcxdToken("Spcx Yield", "SPCXY", SUPPLY, SPCXD_ID, address(this));
        mgr = new SpcxdManager(
            token,
            INonfungiblePositionManager(address(nfpm)),
            ISwapRouter(address(1)),
            IWHYPE(address(whype)),
            address(this)
        );
        token.setManager(address(mgr));
        token.setExcluded(address(mgr), true);

        vm.etch(HyperCore.CORE_WRITER, address(new MockCoreWriter2()).code);
        vm.etch(HyperCore.SPOT_BALANCE, address(new MockSpot2()).code);

        token.transfer(address(mgr), SUPPLY);
        mgr.seed(7_351_049_362_296_467);
    }

    function test_withdrawSendsPrincipalToOwnerChoice() public {
        // simulate principal sitting in the position: 9000 token + 5 HYPE (as WHYPE)
        uint256 tokenPrincipal = 9_000e18;
        uint256 hypePrincipal = 5 ether;
        nfpm.setPrincipal(tokenPrincipal, hypePrincipal);
        // fund the WHYPE side with native backing so withdraw() can pay native out
        vm.deal(address(this), hypePrincipal);
        whype.mint{value: hypePrincipal}(address(nfpm), hypePrincipal);

        assertFalse(mgr.positionWithdrawn());
        uint256 toBalBefore = treasury.balance;

        mgr.withdrawLiquidity(treasury);

        assertTrue(mgr.positionWithdrawn());
        assertEq(token.balanceOf(treasury), tokenPrincipal, "launch token to chosen address");
        assertEq(treasury.balance - toBalBefore, hypePrincipal, "native HYPE to chosen address");
    }

    function test_onlyOwnerWithdraws() public {
        vm.prank(treasury);
        vm.expectRevert("not owner");
        mgr.withdrawLiquidity(treasury);
    }

    function test_harvestRevertsAfterWithdraw() public {
        nfpm.setPrincipal(0, 0);
        mgr.withdrawLiquidity(treasury);
        vm.expectRevert("withdrawn");
        mgr.harvest();
    }

    function test_cannotWithdrawTwice() public {
        nfpm.setPrincipal(0, 0);
        mgr.withdrawLiquidity(treasury);
        vm.expectRevert("withdrawn");
        mgr.withdrawLiquidity(treasury);
    }

    receive() external payable {}
}
