// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

import {SeriesERC20} from "./SeriesERC20.sol";

interface ICallToken1155 {
    // mint/burn/balances used by the wrapper
    function mint(address to, uint256 id, uint256 amount) external;
    function burn(address from, uint256 id, uint256 amount) external;
    function balanceOf(address account, uint256 id) external view returns (uint256);

    // role functions (so owner or scripts can grant)
    function MINTER_ROLE() external view returns (bytes32);
    function grantRole(bytes32 role, address account) external;
}

/**
 * @title CallTokenWrapper
 * @notice Wraps ERC-1155 options into per-series ERC-20 (1 option = 1e18 units).
 */
contract CallTokenWrapper is ERC1155Holder, Ownable, ReentrancyGuard {
    ICallToken1155 public immutable CALLTOKEN;
    mapping(uint256 => address) public seriesToken; // seriesId => SeriesERC20

    uint256 private constant ONE = 1e18;

    event SeriesCreated(uint256 indexed id, address token);
    event Wrapped(address indexed user, uint256 indexed id, uint256 options, uint256 erc20Minted);
    event Unwrapped(address indexed user, uint256 indexed id, uint256 erc20Burned, uint256 options);

    // NOTE: accept raw address to avoid cross-unit interface identity conflicts
    constructor(address callTokenAddr, address owner_) Ownable(owner_) {
        require(callTokenAddr != address(0), "wrapper: callToken=0");
        CALLTOKEN = ICallToken1155(callTokenAddr);
    }

    /// @notice Ensure an ERC-20 exists for a series; creates if missing.
    function ensureSeriesERC20(
        uint256 id,
        string calldata name,
        string calldata symbol
    ) external returns (address token) {
        token = seriesToken[id];
        if (token == address(0)) {
            token = address(new SeriesERC20(name, symbol, id, owner(), address(this)));
            seriesToken[id] = token;
            emit SeriesCreated(id, token);
        }
    }

    function getSeriesToken(uint256 id) external view returns (address) {
        return seriesToken[id];
    }

    /// @notice Wrap ERC-1155 options into ERC-20 units at 1:1e18.
    function wrap(uint256 id, uint256 optionsQty) external nonReentrant {
        require(optionsQty > 0, "wrap: qty=0");
        address token = seriesToken[id];
        require(token != address(0), "wrap: series not created");

        // Burn user's 1155 options (wrapper must have MINTER_ROLE in CallToken)
        CALLTOKEN.burn(msg.sender, id, optionsQty);

        // Mint ERC-20 to user (1 option -> 1e18 units)
        uint256 amount20 = optionsQty * ONE;
        SeriesERC20(token).mint(msg.sender, amount20);

        emit Wrapped(msg.sender, id, optionsQty, amount20);
    }

    /// @notice Unwrap ERC-20 back to ERC-1155 options (only multiples of 1e18).
    function unwrap(uint256 id, uint256 erc20Amount) external nonReentrant {
        require(erc20Amount > 0, "unwrap: amt=0");
        address token = seriesToken[id];
        require(token != address(0), "unwrap: series not created");

        SeriesERC20(token).burnFrom(msg.sender, erc20Amount);

        require(erc20Amount % ONE == 0, "unwrap: not multiple of 1e18");
        uint256 optionsQty = erc20Amount / ONE;

        CALLTOKEN.mint(msg.sender, id, optionsQty);

        emit Unwrapped(msg.sender, id, erc20Amount, optionsQty);
    }
}