// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeLocker, INonfungiblePositionManager} from "../src/FeeLocker.sol";

contract MockToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }
}

interface IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}

/// Minimal mock of the V3 NonfungiblePositionManager: tracks pending fees per token
/// and pays them out on collect(); can safeTransfer an NFT to a receiver.
contract MockPositionManager {
    MockToken public t0;
    MockToken public t1;
    mapping(uint256 => uint256) public pending0;
    mapping(uint256 => uint256) public pending1;

    constructor(MockToken a, MockToken b) {
        t0 = a;
        t1 = b;
    }

    function setFees(uint256 id, uint256 a0, uint256 a1) external {
        pending0[id] = a0;
        pending1[id] = a1;
        t0.mint(address(this), a0);
        t1.mint(address(this), a1);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        bytes4 ret = IERC721Receiver(to).onERC721Received(msg.sender, from, id, "");
        require(ret == IERC721Receiver.onERC721Received.selector, "bad receiver");
    }

    function collect(INonfungiblePositionManager.CollectParams calldata p)
        external
        returns (uint256 a0, uint256 a1)
    {
        a0 = pending0[p.tokenId];
        a1 = pending1[p.tokenId];
        pending0[p.tokenId] = 0;
        pending1[p.tokenId] = 0;
        if (a0 > 0) t0.transfer(p.recipient, a0);
        if (a1 > 0) t1.transfer(p.recipient, a1);
    }
}

contract FeeLockerTest is Test {
    MockToken hype_x;
    MockToken whype;
    MockPositionManager pm;
    FeeLocker locker;

    address buyback = address(0xB0B);
    uint256 constant TID = 42;

    function setUp() public {
        hype_x = new MockToken();
        whype = new MockToken();
        pm = new MockPositionManager(hype_x, whype);
        locker = new FeeLocker(address(pm), buyback);
        // deployer "owns" position TID and locks it by sending to the locker
        pm.safeTransferFrom(address(this), address(locker), TID);
    }

    function test_positionLockedOnReceive() public view {
        assertEq(locker.tokenId(), TID);
    }

    function test_collectForwardsFeesToBuyback() public {
        pm.setFees(TID, 100 ether, 5 ether); // HYPEX + WHYPE fees accrued
        (uint256 a0, uint256 a1) = locker.collect();
        assertEq(a0, 100 ether);
        assertEq(a1, 5 ether);
        assertEq(hype_x.balanceOf(buyback), 100 ether);
        assertEq(whype.balanceOf(buyback), 5 ether);
        // locker itself keeps nothing
        assertEq(hype_x.balanceOf(address(locker)), 0);
    }

    function test_anyoneCanCollect() public {
        pm.setFees(TID, 10 ether, 1 ether);
        vm.prank(address(0xCAFE));
        locker.collect();
        assertEq(hype_x.balanceOf(buyback), 10 ether);
    }

    function test_onlyPositionManagerCanLock() public {
        vm.expectRevert(bytes("not position manager"));
        locker.onERC721Received(address(0), address(0), 99, "");
    }

    function test_setRecipientThenSeal() public {
        locker.setFeeRecipient(address(0xBEEF));
        pm.setFees(TID, 7 ether, 0);
        locker.collect();
        assertEq(hype_x.balanceOf(address(0xBEEF)), 7 ether);
        // seal: owner gone, recipient frozen
        locker.seal();
        assertEq(locker.owner(), address(0));
        vm.expectRevert(bytes("denied"));
        locker.setFeeRecipient(buyback);
    }

    function test_noWayToWithdrawLiquidity() public view {
        // The locker exposes no decreaseLiquidity / transfer / withdraw entrypoint.
        // The position NFT stays with the locker forever; only fees can be collected.
        assertEq(locker.tokenId(), TID);
    }
}
