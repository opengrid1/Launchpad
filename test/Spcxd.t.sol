// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SpcxdToken, IERC20Min} from "../src/spcx/SpcxdToken.sol";
import {SpcxdManager, IERC20Full} from "../src/spcx/SpcxdManager.sol";
import {HyperCore} from "../src/spcx/HyperCore.sol";
import {INonfungiblePositionManager, ISwapRouter, IWHYPE} from "../src/interfaces/IHyperswapV3.sol";
import {MockWHYPE, MockPool, MockPositionManager, MockSwapRouter} from "./mocks/HyperswapV3Mocks.sol";

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
    }

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
    }

    function approve(address sp, uint256 v) external returns (bool) {
        allowance[msg.sender][sp] = v;
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        return _t(msg.sender, to, v);
    }

    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        uint256 a = allowance[f][msg.sender];
        if (a != type(uint256).max) allowance[f][msg.sender] = a - v;
        return _t(f, to, v);
    }

    function _t(address f, address to, uint256 v) internal returns (bool) {
        require(balanceOf[f] >= v, "bal");
        balanceOf[f] -= v;
        balanceOf[to] += v;
        return true;
    }
}

contract MockCoreWriter {
    bytes public lastAction;

    function sendRawAction(bytes calldata d) external {
        lastAction = d;
    }
}

contract MockSpot {
    mapping(bytes32 => uint64) public bal;

    function set(address u, uint64 t, uint64 v) external {
        bal[keccak256(abi.encode(u, t))] = v;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        (address u, uint64 t) = abi.decode(input, (address, uint64));
        return abi.encode(bal[keccak256(abi.encode(u, t))], uint64(0), uint64(0));
    }
}

contract SpcxdTest is Test {
    SpcxdToken token;
    SpcxdManager mgr;
    MockWHYPE whype;
    MockPositionManager pm;
    MockSwapRouter router;
    MockERC20 usdc;
    MockERC20 spcxd;
    MockSpot spot;

    uint256 constant SUPPLY = 10_000e18;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        whype = new MockWHYPE();
        pm = new MockPositionManager();
        router = new MockSwapRouter(pm);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        spcxd = new MockERC20("SpaceX dStock", "SPCXd", 18);

        token = new SpcxdToken("Spcx Yield", "SPCXY", SUPPLY, IERC20Min(address(spcxd)), address(this));
        mgr = new SpcxdManager(
            token,
            INonfungiblePositionManager(address(pm)),
            ISwapRouter(address(router)),
            IWHYPE(address(whype)),
            IERC20Full(address(usdc)),
            IERC20Full(address(spcxd)),
            500,
            address(this)
        );
        token.setManager(address(mgr));
        token.setExcluded(address(mgr), true);

        // install HyperCore mocks
        vm.etch(HyperCore.CORE_WRITER, address(new MockCoreWriter()).code);
        spot = new MockSpot();
        vm.etch(HyperCore.SPOT_BALANCE, address(spot).code);
    }

    function _spotSet(address u, uint64 t, uint64 v) internal {
        MockSpot(payable(HyperCore.SPOT_BALANCE)).set(u, t, v);
    }

    function _action() internal view returns (bytes memory) {
        return MockCoreWriter(HyperCore.CORE_WRITER).lastAction();
    }

    function _split(bytes memory d) internal pure returns (uint24 act, bytes memory params) {
        act = uint24(uint8(d[1])) << 16 | uint24(uint8(d[2])) << 8 | uint24(uint8(d[3]));
        params = new bytes(d.length - 4);
        for (uint256 i = 0; i < params.length; i++) {
            params[i] = d[i + 4];
        }
    }

    // ---- distribution accounting (the core) ----
    function test_rewardProRataAndClaim() public {
        token.transfer(alice, 1_000e18);
        token.transfer(bob, 3_000e18);

        // simulate SPCXD already delivered to the token, then booked
        spcxd.mint(address(token), 4e18);
        vm.prank(address(mgr));
        token.notifyReward(4e18);

        assertApproxEqAbs(token.withdrawableReward(alice), 1e18, 2); // 1/4
        assertApproxEqAbs(token.withdrawableReward(bob), 3e18, 2); // 3/4

        vm.prank(alice);
        uint256 got = token.claimReward();
        assertApproxEqAbs(got, 1e18, 2);
        assertApproxEqAbs(spcxd.balanceOf(alice), 1e18, 2, "alice received SPCXD ERC20");
    }

    function test_bufferThenFlush() public {
        spcxd.mint(address(token), 1e18);
        vm.prank(address(mgr));
        token.notifyReward(1e18); // no holders -> buffer
        token.transfer(alice, 1_000e18);
        assertEq(token.withdrawableReward(alice), 0);

        spcxd.mint(address(token), 1e18);
        vm.prank(address(mgr));
        token.notifyReward(1e18); // flush buffer + new
        assertApproxEqAbs(token.withdrawableReward(alice), 2e18, 2);
    }

    // ---- manager step 2: buy emits a correct IOC limit order ----
    function test_buySpcxdEmitsOrder() public {
        _spotSet(address(mgr), mgr.USDC_CORE(), 200_000_000); // $2 on core
        mgr.buySpcxd(18_500_000_000, 1_000_000); // max $185, 0.01 SPCXD
        (uint24 act, bytes memory p) = _split(_action());
        assertEq(uint256(act), uint256(HyperCore.ACT_LIMIT_ORDER));
        (uint32 asset, bool isBuy, uint64 px, uint64 sz,, uint8 tif,) =
            abi.decode(p, (uint32, bool, uint64, uint64, bool, uint8, uint128));
        assertEq(asset, mgr.SPCXD_ASSET()); // 10465
        assertTrue(isBuy);
        assertEq(px, 18_500_000_000);
        assertEq(sz, 1_000_000);
        assertEq(tif, 3); // IOC
    }

    function test_buyRevertsWithoutUsdc() public {
        vm.expectRevert("no usdc on core");
        mgr.buySpcxd(1, 1);
    }

    // ---- manager step 3: pull emits a spot-send to the SPCXD system address ----
    function test_pullEmitsSpotSendToSystemAddr() public {
        _spotSet(address(mgr), mgr.SPCXD_CORE(), 50_000_000); // 0.5 SPCXD on core
        uint64 amt = mgr.pullSpcxdToEvm();
        assertEq(amt, 50_000_000);
        (uint24 act, bytes memory p) = _split(_action());
        assertEq(uint256(act), uint256(HyperCore.ACT_SPOT_SEND));
        (address dest, uint64 tok, uint64 a) = abi.decode(p, (address, uint64, uint64));
        assertEq(dest, HyperCore.systemAddress(610), "bridge to SPCXD system address");
        assertEq(tok, 610);
        assertEq(a, 50_000_000);
    }

    // ---- manager step 4: distribute hands SPCXD to the token and books it ----
    function test_distributeBooksToHolders() public {
        token.transfer(alice, 1_000e18);
        spcxd.mint(address(mgr), 2e18); // SPCXD arrived on EVM after the bridge
        uint256 amt = mgr.distribute();
        assertEq(amt, 2e18);
        assertEq(spcxd.balanceOf(address(token)), 2e18, "token holds the reward reserve");
        assertApproxEqAbs(token.withdrawableReward(alice), 2e18, 2);
    }

    function test_systemAddressDerivation() public pure {
        assertEq(HyperCore.systemAddress(0), 0x2000000000000000000000000000000000000000);
        assertEq(HyperCore.systemAddress(610), address(uint160(uint160(0x20) << 152 | 610)));
    }

    receive() external payable {}
}
