// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @notice Normalises Chainlink GNO/USD to 1e18 and (optionally) treats WXDAI ~ USD.
///         If you want strict WXDAI, plug a WXDAI/USD feed and divide.
contract ChainlinkPriceAdapter {
    error StalePrice();
    error BadAnswer();

    uint256 public immutable STALE_AFTER; // seconds
    IAggregatorV3 public immutable gnoUsd;

    constructor(IAggregatorV3 _gnoUsd, uint256 staleAfter) {
        gnoUsd = _gnoUsd;
        STALE_AFTER = staleAfter;
    }

    /// @return price 1 GNO priced in WXDAI units, scaled to 1e18
    function latestAnswer() external view returns (uint256) {
        (, int256 ans, , uint256 updatedAt, ) = gnoUsd.latestRoundData();
        if (ans <= 0) revert BadAnswer();
        if (block.timestamp - updatedAt > STALE_AFTER) revert StalePrice();

        uint8 d = gnoUsd.decimals();
        uint256 price = uint256(ans);

        if (d < 18) price = price * (10 ** (18 - d));
        else if (d > 18) price = price / (10 ** (d - 18));

        return price;
    }
}