// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import {OptionsVault} from "../src/core/OptionsVault.sol";
import {CallToken} from "../src/token/CallToken.sol";
import {MockERC20} from "./helpers/MockERC20.sol";
import {MockOracle} from "./helpers/MockOracle.sol";
import {IdLib} from "../src/libs/IdLib.sol";

contract OptionsVaultProRataTest is Test {
    address admin = address(0xA11CE);
    address makerA = address(0xAAA1);
    address makerB = address(0xBBB2);
    address taker  = address(0xCAFE);

    MockERC20 underlying;
    CallToken callToken;
    OptionsVault vault;
    MockOracle oracle;

    uint8 constant UDEC = 18;
    uint256 constant ONE = 1e18;
    uint64  constant DAY = 86400;

    uint256 strike = 100 * ONE;
    uint256 collatPerOption = 1 * ONE; // 1 GNO / option
    uint64  expiry;
    uint256 seriesId;

    function setUp() public {
        vm.startPrank(admin);
        underlying = new MockERC20("Mock GNO", "mGNO", UDEC);
        callToken = new CallToken("https://base-uri", admin);
        vault = new OptionsVault(underlying, callToken, admin);
        callToken.grantRole(callToken.MINTER_ROLE(), address(vault));
        oracle = new MockOracle();
        vm.stopPrank();

        // mint balances to makers
        underlying.mint(makerA, 1_000 * ONE);
        underlying.mint(makerB, 1_000 * ONE);

        // define series
        expiry = uint64(block.timestamp + 7 * DAY);
        seriesId = IdLib.buildId(address(underlying), strike, expiry);

        vm.prank(admin);
        vault.defineSeries(
            address(underlying),
            UDEC,
            strike,
            expiry,
            collatPerOption,
            address(oracle)
        );
    }

    function testProRataReclaim() public {
        // MakerA mints 10 options (locks 10)
        vm.startPrank(makerA);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(20 * ONE);
        vault.mintOptions(seriesId, 10);
        vm.stopPrank();

        // MakerB mints 30 options (locks 30)
        vm.startPrank(makerB);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(40 * ONE);
        vault.mintOptions(seriesId, 30);
        vm.stopPrank();

        // Transfer 40 options to taker (simulate sale)
        vm.startPrank(makerA);
        callToken.safeTransferFrom(makerA, taker, seriesId, 10, "");
        vm.stopPrank();
        vm.startPrank(makerB);
        callToken.safeTransferFrom(makerB, taker, seriesId, 30, "");
        vm.stopPrank();

        // ITM: price 150, strike 100 -> intrinsic 50
        // payoff per option in underlying = (price-strike)/price = 50/150 = 1/3
        // For 40 exercised options => totalExerciseOut = 40 * (1/3) = 13.333... GNO
        oracle.setAnswer(150 * ONE);

        vm.warp(expiry + 1);

        // settle series
        vm.prank(makerA);
        vault.settleSeries(seriesId);

        // taker exercises all 40
        uint256 takerBefore = underlying.balanceOf(taker);
        vm.prank(taker);
        vault.exercise(seriesId, 40);
        uint256 takerAfter = underlying.balanceOf(taker);

        // Check totalExerciseOut ~= 40/3
        uint256 expectedPayoff = (40 * ONE) / 3;
        assertApproxEqAbs(takerAfter - takerBefore, expectedPayoff, 5, "taker payoff");

        // Pro-rata shares:
        // totalLockedBySeries = 10 + 30 = 40
        // MakerA share = totalOut * 10/40 = expectedPayoff * 1/4
        // MakerB share = totalOut * 30/40 = expectedPayoff * 3/4
        uint256 shareA = (expectedPayoff * 10) / 40;
        uint256 shareB = (expectedPayoff * 30) / 40;

        // Reclaim
        uint256 aBalBefore = underlying.balanceOf(makerA);
        vm.prank(makerA);
        vault.reclaim(seriesId);
        uint256 aBalAfter = underlying.balanceOf(makerA);

        uint256 bBalBefore = underlying.balanceOf(makerB);
        vm.prank(makerB);
        vault.reclaim(seriesId);
        uint256 bBalAfter = underlying.balanceOf(makerB);

        // MakerA locked 10 => reclaim 10 - shareA
        assertApproxEqAbs(aBalAfter - aBalBefore, (10 * ONE) - shareA, 5, "makerA reclaim");
        // MakerB locked 30 => reclaim 30 - shareB
        assertApproxEqAbs(bBalAfter - bBalBefore, (30 * ONE) - shareB, 5, "makerB reclaim");
    }
}