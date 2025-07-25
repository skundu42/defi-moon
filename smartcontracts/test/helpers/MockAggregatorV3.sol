// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAggregatorV3} from "../../src/oracle/interfaces/IAggregatorV3.sol";

contract MockAggregatorV3 is IAggregatorV3 {
    uint8 public override decimals;
    int256 public ans;
    uint256 public updatedAt;
    uint80 public roundId = 1;
    uint256 public startedAt = 1;
    uint80 public answeredInRound = 1;

    constructor(uint8 _decimals) {
        decimals = _decimals;
    }

    function set(int256 _ans, uint256 _updatedAt) external {
        ans = _ans;
        updatedAt = _updatedAt;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId, ans, startedAt, updatedAt, answeredInRound);
    }
}