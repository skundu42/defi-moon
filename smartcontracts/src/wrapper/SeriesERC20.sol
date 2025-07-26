// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SeriesERC20
 * @notice ERC-20 wrapper for a single option series (1 option = 1e18 units).
 *         Minting is restricted to the wrapper contract. Burning uses ERC20Burnable.
 */
contract SeriesERC20 is ERC20, ERC20Burnable, Ownable {
    uint256 public immutable SERIES_ID;
    address public immutable WRAPPER;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 seriesId_,
        address owner_,     // initial owner (OZ Ownable v5)
        address wrapper_    // minter (the CallTokenWrapper)
    ) ERC20(name_, symbol_) Ownable(owner_) {
        SERIES_ID = seriesId_;
        WRAPPER = wrapper_;
    }

    modifier onlyWrapper() {
        require(msg.sender == WRAPPER, "SeriesERC20: not wrapper");
        _;
    }

    function decimals() public pure override returns (uint8) {
        return 18; // 1 option = 1e18 units
    }

    /// @notice Mint by wrapper when wrapping ERC-1155 options.
    function mint(address to, uint256 amount) external onlyWrapper {
        _mint(to, amount);
    }
}