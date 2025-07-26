// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import {OptionsVault} from "../src/core/OptionsVault.sol";
import {CallToken} from "../src/token/CallToken.sol";
import {CallTokenWrapper} from "../src/wrapper/CallTokenWrapper.sol";
import {SeriesERC20} from "../src/wrapper/SeriesERC20.sol";

import {MockERC20} from "./helpers/MockERC20.sol";
import {MockOracle} from "./helpers/MockOracle.sol";
import {IdLib} from "../src/libs/IdLib.sol";

// Use the raw selector so we don't import OZ Pausable
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

    CallTokenWrapper wrapper;        // NEW: wrapper (Ownable)
    CallTokenWrapper wrapperNoRole;  // NEW: wrapper without MINTER_ROLE (negative test)

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

        // mint tokens to maker
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

        // --- NEW: deploy wrapper(s) ---
        // wrapper: Ownable(owner_=admin), constructor(address callTokenAddr, address owner_)
        wrapper = new CallTokenWrapper(address(callToken), admin);
        // grant MINTER_ROLE to wrapper so it can burn/mint 1155 during wrap/unwrap
        callToken.grantRole(callToken.MINTER_ROLE(), address(wrapper));

        // negative-test wrapper without minter role
        wrapperNoRole = new CallTokenWrapper(address(callToken), admin);

        vm.stopPrank();
    }

    // -------- existing vault tests --------

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

        // transfer options to taker to simulate sale
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
        // payoff per option in GNO = (price - strike)/price
        // for 2 options => 2 * 50/150 = 2/3 GNO
        assertApproxEqAbs(
            takerBalAfter - takerBalBefore,
            (2 * 50 * ONE) / (150),
            2 // tolerance in wei
        );

        // maker reclaims locked collateral (MVP logic)
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
        vm.expectRevert(EnforcedPause); // OZ custom error
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

    // -------- NEW: wrapper & series-ERC20 tests --------

    function testEnsureSeriesERC20Once() public {
        vm.startPrank(admin);

        address token1 = wrapper.ensureSeriesERC20(seriesId, "Series GNO 100", "cGNO-100");
        assertTrue(token1 != address(0));

        // idempotent: returns existing address
        address token2 = wrapper.ensureSeriesERC20(seriesId, "IGNORED", "IGNORED");
        assertEq(token1, token2);

        // basic props
        uint8 dec = SeriesERC20(token1).decimals();
        assertEq(dec, 18); // 1 option = 1e18 units

        vm.stopPrank();
    }

    function testWrapAndUnwrapLifecycle() public {
        // maker deposits and mints 5 options
        vm.startPrank(maker);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(10 * ONE);
        vault.mintOptions(seriesId, 5);
        vm.stopPrank();

        // create the ERC20 for this series
        vm.prank(admin);
        address series20 = wrapper.ensureSeriesERC20(seriesId, "Series GNO 100", "cGNO-100");

        // maker wraps 3 options -> mints 3e18 ERC20 to maker
        vm.prank(maker);
        wrapper.wrap(seriesId, 3);
        assertEq(SeriesERC20(series20).balanceOf(maker), 3 * ONE);
        assertEq(callToken.balanceOf(maker, seriesId), 2); // 5 - 3 wrapped = 2 options left

        // unwrap requires allowance (burnFrom by wrapper) — approve wrapper first
        vm.prank(maker);
        SeriesERC20(series20).approve(address(wrapper), 2 * ONE); // unwrap 2 options

        // unwrap 2e18 -> receive 2 options back
        vm.prank(maker);
        wrapper.unwrap(seriesId, 2 * ONE);

        // balances after unwrap
        assertEq(SeriesERC20(series20).balanceOf(maker), 1 * ONE); // 3e18 - 2e18
        assertEq(callToken.balanceOf(maker, seriesId), 4);         // 2 + 2
    }

    function testWrapRevertsIfSeriesTokenMissing() public {
        // maker mints 1 option
        vm.startPrank(maker);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(2 * ONE);
        vault.mintOptions(seriesId, 1);
        vm.stopPrank();

        // do NOT create the ERC20; wrap should revert with "series not created"
        vm.prank(maker);
        vm.expectRevert(bytes("wrap: series not created"));
        wrapper.wrap(seriesId, 1);
    }

    function testUnwrapMustBeMultipleOf1e18() public {
        // set up ERC20 and wrap 1 option
        vm.startPrank(admin);
        address series20 = wrapper.ensureSeriesERC20(seriesId, "Series GNO 100", "cGNO-100");
        vm.stopPrank();

        vm.startPrank(maker);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(2 * ONE);
        vault.mintOptions(seriesId, 1);
        wrapper.wrap(seriesId, 1); // balance: 1e18
        // approve wrapper for burnFrom
        SeriesERC20(series20).approve(address(wrapper), type(uint256).max);

        // try to unwrap not multiple of 1e18
        vm.expectRevert(bytes("unwrap: not multiple of 1e18"));
        wrapper.unwrap(seriesId, ONE - 1);
        vm.stopPrank();
    }

    function testWrapRevertsWithoutMinterRole() public {
        // create a second series or reuse; create ERC20 in wrapperNoRole
        vm.prank(admin);
        address tokenNoRole = wrapperNoRole.ensureSeriesERC20(seriesId, "S", "S");

        // maker mints 1 option
        vm.startPrank(maker);
        underlying.approve(address(vault), type(uint256).max);
        vault.deposit(2 * ONE);
        vault.mintOptions(seriesId, 1);
        vm.stopPrank();

        // attempt to wrap via wrapperNoRole -> should revert (no MINTER_ROLE to burn 1155)
        vm.prank(maker);
        vm.expectRevert(); // AccessControl: missing role in CallToken.burn
        wrapperNoRole.wrap(seriesId, 1);

        // sanity: token address exists but unused
        assertTrue(tokenNoRole != address(0));
    }
}