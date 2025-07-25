// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import {OptionsVault} from "../src/core/OptionsVault.sol";
import {CallToken} from "../src/token/CallToken.sol";
import {MockERC20} from "./helpers/MockERC20.sol";
import {MockOracle} from "./helpers/MockOracle.sol";
import {IdLib} from "../src/libs/IdLib.sol";

// Use the raw selector so we don't need to import Pausable (and to be OZ-version agnostic)
bytes4 constant EnforcedPause = bytes4(keccak256("EnforcedPause()"));

contract OptionsVaultTest is Test {
    // actors
    address admin = address(0xA11CE);
    address maker = address(0xBEEF);
    address taker = address(0xCAFE);
    address rando = address(0xBADA55);

    // contracts
    MockERC20 underlying;   // mock GNO
    CallToken callToken;
    OptionsVault vault;
    MockOracle oracle;

    // constants
    uint8 constant UNDERLYING_DECIMALS = 18;
    uint256 constant ONE = 1e18;
    uint64  constant DAY = 86400;

    // common series params
    uint256 strike = 100 * ONE;            // 100 WXDAI
    uint256 collatPerOption = 1 * ONE;     // 1 GNO per option
    uint64  expiry;

    uint256 seriesId;

    function setUp() public {
        vm.startPrank(admin);

        underlying = new MockERC20("Mock GNO", "mGNO", UNDERLYING_DECIMALS);
        callToken = new CallToken("https://base-uri", admin);

        vault = new OptionsVault(underlying, callToken, admin);

        // allow the vault to mint/burn ERC1155
        callToken.grantRole(callToken.MINTER_ROLE(), address(vault));

        oracle = new MockOracle();

        // give roles, mint tokens to maker
        underlying.mint(maker, 1_000 * ONE);

        // define a series
        expiry = uint64(block.timestamp + 7 * DAY);
        seriesId = IdLib.buildId(address(underlying), strike, expiry);

        vault.defineSeries(
            address(underlying),
            UNDERLYING_DECIMALS,
            strike,
            expiry,
            collatPerOption,
            address(oracle)
        );

        vm.stopPrank();
    }

    function testDefineSeriesOnlyAdmin() public {
        vm.prank(rando);
        vm.expectRevert(); // AccessControl: missing SERIES_ADMIN_ROLE
        vault.defineSeries(address(underlying), UNDERLYING_DECIMALS, strike, expiry + 1, collatPerOption, address(oracle));
    }

    function testDepositWithdraw() public {
        // maker deposits 10 GNO
        vm.startPrank(maker);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(10 * ONE);

        assertEq(vault.collateralBalance(maker), 10 * ONE);
        assertEq(vault.freeCollateralOf(maker), 10 * ONE);

        // withdraw 3
        vault.withdraw(3 * ONE);
        assertEq(vault.collateralBalance(maker), 7 * ONE);
        assertEq(vault.freeCollateralOf(maker), 7 * ONE);

        // cannot withdraw more than free
        vm.expectRevert("not enough free");
        vault.withdraw(8 * ONE);
        vm.stopPrank();
    }

    function testMintLocksCollateral() public {
        vm.startPrank(maker);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(10 * ONE);

        // mint 5 options -> requires 5 GNO collateral
        vault.mintOptions(seriesId, 5);
        assertEq(callToken.balanceOf(maker, seriesId), 5);
        assertEq(vault.collateralBalance(maker), 10 * ONE);
        assertEq(vault.totalLocked(maker), 5 * ONE);
        assertEq(vault.freeCollateralOf(maker), 5 * ONE);
        assertEq(vault.lockedPerSeries(maker, seriesId), 5 * ONE);

        // cannot mint if not enough free collateral
        vm.expectRevert("insufficient collateral");
        vault.mintOptions(seriesId, 6);
        vm.stopPrank();
    }

    function testSettleOTMThenExerciseNoPayoutAndReclaim() public {
        // maker mints 2 options
        vm.startPrank(maker);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(10 * ONE);
        vault.mintOptions(seriesId, 2);
        vm.stopPrank();

        // transfer options to taker to simulate 1inch sale fill
        vm.prank(maker);
        callToken.safeTransferFrom(maker, taker, seriesId, 2, "");

        // fast forward to expiry + settle
        vm.warp(expiry + 1);
        // set oracle price BELOW strike -> OTM
        oracle.setAnswer(90 * ONE);

        vm.prank(maker);
        vault.settleSeries(seriesId);

        // taker exercises -> should get 0
        vm.prank(taker);
        vault.exercise(seriesId, 2);

        assertEq(callToken.balanceOf(taker, seriesId), 0, "tokens burned");
        assertEq(underlying.balanceOf(taker), 0);

        // maker reclaims all locked collateral
        uint256 lockedBefore = vault.lockedPerSeries(maker, seriesId);
        assertEq(lockedBefore, 2 * ONE);
        uint256 makerBalBefore = underlying.balanceOf(maker);

        vm.prank(maker);
        vault.reclaim(seriesId);

        assertEq(vault.lockedPerSeries(maker, seriesId), 0);
        assertEq(vault.totalLocked(maker), 0);
        assertEq(underlying.balanceOf(maker), makerBalBefore + lockedBefore);
    }

    function testSettleITMThenExercisePaysAndReclaim() public {
        // maker mints 2 options
        vm.startPrank(maker);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(10 * ONE);
        vault.mintOptions(seriesId, 2);
        vm.stopPrank();

        // transfer options to taker
        vm.prank(maker);
        callToken.safeTransferFrom(maker, taker, seriesId, 2, "");

        // ITM: price = 150, strike = 100, intrinsic = 50
        // payoff per option in GNO = intrinsicWx / price = 50 / 150 = 1/3 GNO
        // for 2 options => 2/3 GNO
        oracle.setAnswer(150 * ONE);

        vm.warp(expiry + 1);
        vm.prank(maker);
        vault.settleSeries(seriesId);

        uint256 takerBalBefore = underlying.balanceOf(taker);

        vm.prank(taker);
        vault.exercise(seriesId, 2);

        // tokens burned
        assertEq(callToken.balanceOf(taker, seriesId), 0);

        uint256 takerBalAfter = underlying.balanceOf(taker);
        // allow small rounding differences (none expected with 1e18, but be safe)
        assertApproxEqAbs(
            takerBalAfter - takerBalBefore,
            (2 * 50 * ONE) / (150),
            2 // tolerance in wei
        );

        // maker reclaims locked collateral (simplistic vault logic)
        vm.prank(maker);
        vault.reclaim(seriesId);

        assertEq(vault.lockedPerSeries(maker, seriesId), 0);
        assertEq(vault.totalLocked(maker), 0);
    }

    function testCannotSettleBeforeExpiry() public {
        vm.expectRevert("not expired");
        vault.settleSeries(seriesId);
    }

    function testCannotExerciseBeforeSettle() public {
        // mint & transfer 1 option to taker
        vm.startPrank(maker);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(10 * ONE);
        vault.mintOptions(seriesId, 1);
        vm.stopPrank();

        vm.prank(maker);
        callToken.safeTransferFrom(maker, taker, seriesId, 1, "");

        vm.prank(taker);
        vm.expectRevert("not settled");
        vault.exercise(seriesId, 1);
    }

    function testCannotMintAfterExpiry() public {
        vm.startPrank(maker);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(10 * ONE);
        vm.warp(expiry + 1);
        vm.expectRevert("expired");
        vault.mintOptions(seriesId, 1);
        vm.stopPrank();
    }

    function testPauseGuards() public {
        vm.prank(admin);
        vault.pause();

        vm.prank(maker);
        vm.expectRevert(EnforcedPause); // OZ custom error, matched by selector
        vault.deposit(1);

        vm.prank(admin);
        vault.unpause();

        vm.startPrank(maker);
        underlying.approve(address(vault), 1);
        vault.deposit(1);
        vm.stopPrank();
    }

    function testAccessControlRoles() public {
        // maker cannot pause
        vm.prank(maker);
        vm.expectRevert(); // missing DEFAULT_ADMIN_ROLE
        vault.pause();

        // admin can
        vm.prank(admin);
        vault.pause();
    }
}