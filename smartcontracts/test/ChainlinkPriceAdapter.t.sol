// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

import {ChainlinkPriceAdapter} from "../src/oracle/ChainlinkPriceAdapter.sol";
import {MockAggregatorV3} from "./helpers/MockAggregatorV3.sol";

contract ChainlinkPriceAdapterTest is Test {
    MockAggregatorV3 agg;
    ChainlinkPriceAdapter adapter;

    uint256 staleAfter = 1 hours;

    function setUp() public {
        agg = new MockAggregatorV3(8); // typical CL decimals
        adapter = new ChainlinkPriceAdapter(agg, staleAfter);
    }

    function testLatestAnswerScalesTo1e18() public {
        int256 price = 12345678901; // 123.45678901 * 1e8
        agg.set(price, block.timestamp);

        uint256 ans = adapter.latestAnswer();
        uint256 expected = uint256(price) * 1e10; // scale 1e8 -> 1e18
        assertEq(ans, expected);
    }

    function testStaleReverts() public {
        // advance to avoid underflow when backdating the oracle timestamp
        vm.warp(block.timestamp + staleAfter + 2);

        int256 price = 100_00000000; // 100 * 1e8
        uint256 t = block.timestamp - staleAfter - 1;
        agg.set(price, t);

        vm.expectRevert(ChainlinkPriceAdapter.StalePrice.selector);
        adapter.latestAnswer();
    }

    function testBadAnswerReverts() public {
        agg.set(0, block.timestamp);

        vm.expectRevert(ChainlinkPriceAdapter.BadAnswer.selector);
        adapter.latestAnswer();
    }
}