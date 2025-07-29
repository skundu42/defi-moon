// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/// @notice Minimal proxy so that an ERC‐20 style transferFrom selector
/// can be used to move a single ERC1155 token + amount + data.
contract ERC1155TransferProxy {
    /// @dev matches IERC20.transferFrom.selector == 0x23b872dd
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        // calldata layout: 
        // [0:4]   0x23b872dd
        // [4:36]  from
        // [36:68] to
        // [68:100] amount
        // [100:] suffix = abi.encode(tokenAddress, tokenId, data)
        bytes calldata suffix = msg.data[100:];
        (address token, uint256 id, bytes memory data) = abi.decode(suffix, (address, uint256, bytes));
        IERC1155(token).safeTransferFrom(from, to, id, amount, data);
        return true;
    }
}