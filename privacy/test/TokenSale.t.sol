// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {UmbraToken} from "../src/UmbraToken.sol";
import {TokenPresale, IERC20} from "../src/TokenPresale.sol";

contract TokenSaleTest is Test {
    UmbraToken token;
    TokenPresale sale;

    address owner = address(0xA11CE);
    address treasury = address(0x712A);
    address alice = address(0xA1);
    address bob = address(0xB0);

    uint256 constant CAP = 100_000_000 ether;     // 100M max supply
    uint256 constant INITIAL = 40_000_000 ether;  // minted at deploy
    uint256 constant FOR_SALE = 10_000_000 ether; // offered in the presale
    uint256 constant PRICE = 0.0001 ether;        // wei per UMBRA
    uint256 constant SOFT = 100 ether;
    uint256 constant HARD = 1000 ether;           // 1000/0.0001 = 10M tokens, matches FOR_SALE

    uint256 start;
    uint256 endt;

    function setUp() public {
        token = new UmbraToken(CAP, owner, INITIAL, owner);
        start = block.timestamp + 1;
        endt = start + 3 days;

        sale = new TokenPresale(
            IERC20(address(token)), treasury, PRICE, FOR_SALE, SOFT, HARD, start, endt, 0
        );

        // fund the sale with the offered tokens
        vm.prank(owner);
        token.transfer(address(sale), FOR_SALE);
    }

    function test_SuccessfulSaleClaimAndTreasury() public {
        vm.warp(start);

        vm.deal(alice, 200 ether);
        vm.prank(alice);
        sale.buy{value: 60 ether}();

        vm.deal(bob, 200 ether);
        vm.prank(bob);
        sale.buy{value: 50 ether}();

        assertEq(sale.totalRaised(), 110 ether);
        assertEq(sale.owed(alice), sale.tokensFor(60 ether));

        vm.warp(endt + 1);
        sale.finalize();
        assertTrue(sale.succeeded());
        assertEq(treasury.balance, 110 ether);

        vm.prank(alice);
        sale.claim();
        assertEq(token.balanceOf(alice), sale.tokensFor(60 ether));

        vm.prank(bob);
        sale.claim();
        assertEq(token.balanceOf(bob), sale.tokensFor(50 ether));
    }

    function test_FailedSaleRefunds() public {
        vm.warp(start);
        vm.deal(alice, 100 ether);
        vm.prank(alice);
        sale.buy{value: 50 ether}(); // below 100 soft cap

        vm.warp(endt + 1);
        sale.finalize();
        assertFalse(sale.succeeded());

        uint256 before = alice.balance;
        vm.prank(alice);
        sale.refund();
        assertEq(alice.balance, before + 50 ether);
        assertEq(treasury.balance, 0);
    }

    function test_HardCapRefundsOverpayAndFinalizesEarly() public {
        vm.warp(start);
        vm.deal(alice, 5000 ether);

        uint256 before = alice.balance;
        vm.prank(alice);
        sale.buy{value: 1200 ether}(); // hard cap is 1000

        assertEq(sale.totalRaised(), HARD);
        assertEq(alice.balance, before - HARD); // 200 refunded in-tx

        // hard cap hit: finalize allowed before end
        sale.finalize();
        assertTrue(sale.succeeded());
    }

    function test_PerWalletCapEnforced() public {
        TokenPresale capped = new TokenPresale(
            IERC20(address(token)), treasury, PRICE, FOR_SALE, SOFT, HARD, start, endt, 30 ether
        );
        vm.prank(owner);
        token.transfer(address(capped), FOR_SALE);

        vm.warp(start);
        vm.deal(alice, 100 ether);
        uint256 before = alice.balance;
        vm.prank(alice);
        capped.buy{value: 50 ether}(); // only 30 accepted

        assertEq(capped.contributed(alice), 30 ether);
        assertEq(alice.balance, before - 30 ether);
    }

    function test_BuyOutsideWindowReverts() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert("not started");
        sale.buy{value: 1 ether}();

        vm.warp(endt + 1);
        vm.prank(alice);
        vm.expectRevert("ended");
        sale.buy{value: 1 ether}();
    }

    function test_TokenMintingRespectsCapAndMinter() public {
        // only the minter may mint
        vm.expectRevert("not minter");
        token.mint(alice, 1 ether);

        address mining = address(0x9111);
        vm.prank(owner);
        token.setMinter(mining);

        vm.prank(mining);
        token.mint(alice, 1 ether);
        assertEq(token.balanceOf(alice), 1 ether);

        // cannot exceed the cap
        vm.prank(mining);
        vm.expectRevert("exceeds cap");
        token.mint(alice, CAP); // would blow past maxSupply
    }
}
