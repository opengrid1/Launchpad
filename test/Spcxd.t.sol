// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SpcxdToken} from "../src/spcx/SpcxdToken.sol";
import {SpcxdManager, IERC20Full} from "../src/spcx/SpcxdManager.sol";
import {HyperCore} from "../src/spcx/HyperCore.sol";
import {INonfungiblePositionManager, ISwapRouter, IWHYPE} from "../src/interfaces/IHyperswapV3.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
    }

    function approve(address sp, uint256 v) external returns (bool) {
        allowance[msg.sender][sp] = v;
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        require(balanceOf[msg.sender] >= v, "bal");
        balanceOf[msg.sender] -= v;
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
    MockSpot spot;

    uint64 constant SPCXD_ID = 610;
    uint256 constant SUPPLY = 10_000e18;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        token = new SpcxdToken("Spcx Yield", "SPCXY", SUPPLY, SPCXD_ID, address(this));
        mgr = new SpcxdManager(
            token,
            INonfungiblePositionManager(address(1)),
            ISwapRouter(address(2)),
            IWHYPE(address(3)),
            address(this)
        );
        token.setManager(address(mgr));
        token.setExcluded(address(mgr), true);

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

    // ---- distribution: SPCXD split pro-rata, claimed straight to Core ----
    function test_rewardProRataAndClaim() public {
        token.transfer(alice, 1_000e18);
        token.transfer(bob, 3_000e18);

        vm.prank(address(mgr));
        token.notifyReward(400_000_000); // 4 SPCXD (8-dec)
        assertApproxEqAbs(token.withdrawableSpcxd(alice), 100_000_000, 1);
        assertApproxEqAbs(token.withdrawableSpcxd(bob), 300_000_000, 1);

        uint256 owed = token.withdrawableSpcxd(alice);
        vm.prank(alice);
        uint64 sent = token.claimSpcxd();
        assertEq(sent, uint64(owed));

        (uint24 act, bytes memory p) = _split(_action());
        assertEq(uint256(act), uint256(HyperCore.ACT_SPOT_SEND));
        (address dest, uint64 tok, uint64 amt) = abi.decode(p, (address, uint64, uint64));
        assertEq(dest, alice, "SPCXD sent to claimer's Core account");
        assertEq(tok, SPCXD_ID);
        assertEq(amt, uint64(owed));
        assertEq(token.withdrawableSpcxd(alice), 0);
    }

    function test_bufferThenFlush() public {
        vm.prank(address(mgr));
        token.notifyReward(50_000_000); // no holders -> buffer
        token.transfer(alice, 1_000e18);
        assertEq(token.withdrawableSpcxd(alice), 0);
        vm.prank(address(mgr));
        token.notifyReward(50_000_000);
        assertApproxEqAbs(token.withdrawableSpcxd(alice), 100_000_000, 1);
    }

    function test_onlyManagerBooks() public {
        vm.prank(alice);
        vm.expectRevert("not manager");
        token.notifyReward(1);
    }

    // ---- manager step 2: sell HYPE -> USDC on the Core book ----
    function test_sellHypeEmitsOrder() public {
        _spotSet(address(mgr), mgr.HYPE_CORE(), 5_000_000); // 0.05 HYPE on core
        mgr.sellHypeForUsdc(6_000_000_000, 5_000_000); // min $60, 0.05 HYPE
        (uint24 act, bytes memory p) = _split(_action());
        assertEq(uint256(act), uint256(HyperCore.ACT_LIMIT_ORDER));
        (uint32 asset, bool isBuy,,,, uint8 tif,) =
            abi.decode(p, (uint32, bool, uint64, uint64, bool, uint8, uint128));
        assertEq(asset, mgr.HYPE_USDC_ASSET()); // 10107
        assertFalse(isBuy); // selling HYPE
        assertEq(tif, 3);
    }

    function test_sellRevertsWithoutHype() public {
        vm.expectRevert("no hype on core");
        mgr.sellHypeForUsdc(1, 1);
    }

    // ---- manager step 3: buy SPCXD with USDC ----
    function test_buySpcxdEmitsOrder() public {
        _spotSet(address(mgr), mgr.USDC_CORE(), 200_000_000);
        mgr.buySpcxd(17_900_000_000, 1_000_000); // max $179, 0.01 SPCXD
        (uint24 act, bytes memory p) = _split(_action());
        assertEq(uint256(act), uint256(HyperCore.ACT_LIMIT_ORDER));
        (uint32 asset, bool isBuy, uint64 px, uint64 sz,, uint8 tif,) =
            abi.decode(p, (uint32, bool, uint64, uint64, bool, uint8, uint128));
        assertEq(asset, mgr.SPCXD_ASSET()); // 10465
        assertTrue(isBuy);
        assertEq(px, 17_900_000_000);
        assertEq(sz, 1_000_000);
        assertEq(tif, 3);
    }

    function test_buyRevertsWithoutUsdc() public {
        vm.expectRevert("no usdc on core");
        mgr.buySpcxd(1, 1);
    }

    // ---- manager step 3: deliver spot-sends SPCXD to the token + books it ----
    function test_deliverToTokenAndBook() public {
        token.transfer(alice, 1_000e18);
        _spotSet(address(mgr), mgr.SPCXD_CORE(), 250_000_000); // 2.5 SPCXD bought, on manager Core

        uint64 amt = mgr.deliverToToken();
        assertEq(amt, 250_000_000);

        (uint24 act, bytes memory p) = _split(_action());
        assertEq(uint256(act), uint256(HyperCore.ACT_SPOT_SEND));
        (address dest, uint64 tok, uint64 a) = abi.decode(p, (address, uint64, uint64));
        assertEq(dest, address(token), "SPCXD moved manager Core -> token Core");
        assertEq(tok, SPCXD_ID);
        assertEq(a, 250_000_000);

        // booked to the sole holder
        assertApproxEqAbs(token.withdrawableSpcxd(alice), 250_000_000, 1);
    }

    function test_systemAddressDerivation() public pure {
        assertEq(HyperCore.systemAddress(0), 0x2000000000000000000000000000000000000000);
        assertEq(HyperCore.systemAddress(610), address(uint160(uint160(0x20) << 152 | 610)));
    }

    receive() external payable {}
}
