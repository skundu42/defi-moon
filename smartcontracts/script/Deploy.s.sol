// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {OptionsVault} from "../src/core/OptionsVault.sol";
import {CallToken} from "../src/token/CallToken.sol";
import {ChainlinkPriceAdapter} from "../src/oracle/ChainlinkPriceAdapter.sol";
import {IAggregatorV3} from "../src/oracle/interfaces/IAggregatorV3.sol";
import {ERC1155TransferProxy} from "../src/core/ERC1155TransferProxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Deploy is Script {
    // GNO token on Gnosis
    address constant GNO = 0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb;
    // Chainlink GNO/USD feed
    address constant CHAINLINK_GNO_USD_FEED = 0x22441d81416430A54336aB28765abd31a792Ad37;
    uint256 constant STALE_AFTER = 3600; // 1 hour

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        address admin = vm.addr(pk);

        // 1) Deploy the ERC-1155 CallToken and vault
        CallToken callToken = new CallToken("https://your-metadata-base", admin);
        OptionsVault vault = new OptionsVault(IERC20(GNO), callToken, admin);
        callToken.grantRole(callToken.MINTER_ROLE(), address(vault));

        // 2) Deploy Chainlink price adapter for GNO/WXDAI
        ChainlinkPriceAdapter adapter =
            new ChainlinkPriceAdapter(IAggregatorV3(CHAINLINK_GNO_USD_FEED), STALE_AFTER);

        // 3) Deploy the 1inch ERC-1155 transfer proxy (no-arg constructor)
        ERC1155TransferProxy proxy = new ERC1155TransferProxy();

        vm.stopBroadcast();

        console2.log("CallToken:               ", address(callToken));
        console2.log("OptionsVault:            ", address(vault));
        console2.log("Chainlink Adapter:       ", address(adapter));
        console2.log("ERC1155 Transfer Proxy:  ", address(proxy));
    }
}