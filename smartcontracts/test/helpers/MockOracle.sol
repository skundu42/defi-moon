// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockOracle {
    uint256 public answer;

    function setAnswer(uint256 _answer) external {
        answer = _answer;
    }

    function latestAnswer() external view returns (uint256) {
        return answer;
    }
}