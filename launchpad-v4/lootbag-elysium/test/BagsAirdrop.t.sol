// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, stdStorage, StdStorage} from "forge-std/Test.sol";
import {KinetiqPumpBags} from "../src/KinetiqPumpBags.sol";
import {KinetiqPumpAirdrop} from "../src/KinetiqPumpAirdrop.sol";

contract MockToken {
    string public name;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n) {
        name = n;
    }

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

/// @dev pays out at a fixed rate: 1 in = `rate` / 1e18 out
contract MockSwapper {
    uint256 public rate = 2e18;

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 out)
    {
        MockToken(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        out = (amountIn * rate) / 1e18;
        require(out >= minOut, "min");
        MockToken(tokenOut).mint(recipient, out);
    }
}

contract BagsAirdropTest is Test {
    using stdStorage for StdStorage;

    MockToken kntq = new MockToken("KNTQ");
    MockToken loot = new MockToken("LOOT");
    MockToken nvda = new MockToken("NVDA");
    MockSwapper swapper = new MockSwapper();
    address owner = makeAddr("kpump.test.owner");
    address treasury = makeAddr("kpump.test.treasury");
    address keeper = makeAddr("kpump.test.keeper");
    address a1 = makeAddr("kpump.test.a1");
    address a2 = makeAddr("kpump.test.a2");
    address a3 = makeAddr("kpump.test.a3");
    KinetiqPumpBags bags;
    KinetiqPumpAirdrop air;

    function setUp() public {
        address[] memory d = new address[](2);
        d[0] = address(kntq);
        d[1] = address(nvda);
        bags = new KinetiqPumpBags(address(kntq), address(swapper), owner, treasury, d, 3e18); // a 3 KNTQ mint: 2.7 to the Bags, 0.3 to KinetiqPump
        air = new KinetiqPumpAirdrop(address(kntq), address(swapper), owner);
        vm.startPrank(owner);
        bags.setLoot(address(loot));
        bags.setKeeper(keeper, true);
        air.setKeeper(keeper, true);
        vm.stopPrank();
        for (uint256 i; i < 3; i++) {
            address w = [a1, a2, a3][i];
            kntq.mint(w, 100e18);
            loot.mint(w, 1_000_000e18);
            vm.startPrank(w);
            kntq.approve(address(bags), type(uint256).max);
            loot.approve(address(bags), type(uint256).max);
            vm.stopPrank();
        }
    }

    function test_mintBurnsLootAndPaysEarlierBags() public {
        vm.prank(a1);
        bags.mint();
        assertEq(loot.balanceOf(bags.DEAD()), 100_000e18);
        assertEq(kntq.balanceOf(treasury), 0.3e18);
        assertEq(bags.pot(), 2.7e18, "the first mint's share stays in the pot");
        vm.prank(a2);
        bags.mint();
        assertEq(bags.vault(1, address(kntq)), 2.7e18, "bag 1 gets the second mint's 2.7 KNTQ");
        assertEq(bags.vault(2, address(kntq)), 0, "a Bag never shares in its own mint");
        vm.prank(a3);
        bags.mint();
        assertEq(bags.vault(1, address(kntq)), 2.7e18 + 1.35e18);
        assertEq(bags.vault(2, address(kntq)), 1.35e18);
        assertEq(bags.vault(3, address(kntq)), 0);
    }

    function test_dropsSplitFivePercentOfThePotEqually() public {
        vm.prank(a1);
        bags.mint();
        vm.prank(a2);
        bags.mint();
        kntq.mint(address(bags), 1000e18); // fee income lands in the pot
        uint256 p = bags.pot();
        // a KNTQ day: anyone can run it
        vm.warp(2 days * 10); // an even UTC day: today() is KNTQ
        assertEq(bags.today(), address(kntq));
        bags.drop(0);
        assertEq(bags.vault(1, address(kntq)), 2.7e18 + (p * 5 / 100) / 2);
        assertEq(bags.vault(2, address(kntq)), (p * 5 / 100) / 2);
        vm.expectRevert(KinetiqPumpBags.TooSoon.selector);
        bags.drop(0);
        // an NVDA day: keepers only, bought through the swapper
        vm.warp(block.timestamp + 1 days);
        assertEq(bags.today(), address(nvda));
        vm.expectRevert(KinetiqPumpBags.NotKeeper.selector);
        bags.drop(0);
        uint256 p2 = bags.pot();
        vm.prank(keeper);
        bags.drop(1);
        assertEq(bags.vault(1, address(nvda)), ((p2 * 5 / 100) * 2) / 2);
    }

    function test_vaultFollowsTheBagAndOnlyItsHolderWithdraws() public {
        vm.prank(a1);
        bags.mint();
        vm.prank(a2);
        bags.mint();
        address[] memory t = new address[](1);
        t[0] = address(kntq);
        vm.prank(a2);
        vm.expectRevert(KinetiqPumpBags.NotHolder.selector);
        bags.withdraw(1, t);
        vm.prank(a1);
        bags.transferFrom(a1, a3, 1);
        uint256 b = kntq.balanceOf(a3);
        vm.prank(a3);
        bags.withdraw(1, t);
        assertEq(kntq.balanceOf(a3) - b, 2.7e18);
        assertEq(bags.vault(1, address(kntq)), 0);
        assertEq(bags.inVaults(address(kntq)), 0);
        (address r, uint256 roy) = bags.royaltyInfo(1, 1 ether);
        assertEq(r, treasury);
        assertEq(roy, 0.05 ether);
    }

    function test_ownerCannotTouchThePotOrVaults() public {
        vm.prank(a1);
        bags.mint();
        kntq.mint(address(bags), 100e18);
        vm.startPrank(owner);
        address[] memory t = new address[](1);
        t[0] = address(kntq);
        vm.expectRevert(KinetiqPumpBags.NotHolder.selector);
        bags.withdraw(1, t);
        vm.stopPrank();
        assertEq(bags.pot(), 102.7e18);
    }

    function test_soldOutAtAThousand() public {
        stdstore.target(address(bags)).sig("minted()").checked_write(uint256(1000));
        vm.prank(a1);
        vm.expectRevert(KinetiqPumpBags.SoldOut.selector);
        bags.mint();
    }

    // ------------------------------------------------------------------ airdrop

    function _leaf(address a, uint256 amt) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a, amt))));
    }

    function _pair(bytes32 x, bytes32 y) internal pure returns (bytes32) {
        return x < y ? keccak256(abi.encode(x, y)) : keccak256(abi.encode(y, x));
    }

    function test_airdropRoundPaysTheListUpToThePot() public {
        kntq.mint(address(air), 100e18);
        bytes32 l1 = _leaf(a1, 60e18);
        bytes32 l2 = _leaf(a2, 40e18);
        bytes32 root = _pair(l1, l2);
        vm.prank(keeper);
        vm.expectRevert(KinetiqPumpAirdrop.OverPot.selector);
        air.post(root, 101e18, "");
        vm.prank(keeper);
        air.post(root, 100e18, "ipfs://list");
        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = l2;
        air.pay(0, a1, 60e18, p1); // anyone pushes it
        assertEq(kntq.balanceOf(a1), 100e18 + 60e18);
        vm.expectRevert(KinetiqPumpAirdrop.AlreadyPaid.selector);
        air.pay(0, a1, 60e18, p1);
        vm.expectRevert(KinetiqPumpAirdrop.BadProof.selector);
        air.pay(0, a3, 40e18, p1);
        // the next round waits 10 hours; the unpaid part comes back after 30 days
        vm.prank(keeper);
        vm.expectRevert(KinetiqPumpAirdrop.TooSoon.selector);
        air.post(root, 0, "");
        vm.warp(block.timestamp + 31 days);
        air.expire(0);
        assertEq(air.pot(), 40e18);
    }
}
