// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library IdLib {
    /// @dev Packs (underlying, strike, expiry) deterministically via keccak256.
    function buildId(address underlying, uint256 strike, uint64 expiry) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(underlying, strike, expiry)));
    }
}