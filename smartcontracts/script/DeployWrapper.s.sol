// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {CallTokenWrapper} from "../src/wrapper/CallTokenWrapper.sol";
import {CallToken} from "../src/token/CallToken.sol";

contract DeployWrapper is Script {
    /// @notice Run with: forge script script/DeployWrapper.s.sol:DeployWrapper \
    ///   --sig "run(address,address)" 0xCALLTOKEN_ADDRESS 0xADMIN_ADDRESS \
    ///   --rpc-url "$GNOSIS_RPC" --broadcast -vvv
    function run(address callTokenAddr, address admin) external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        // Deploy wrapper (constructor now takes plain address)
        CallTokenWrapper wrapper = new CallTokenWrapper(callTokenAddr, admin);

        // Grant MINTER_ROLE to wrapper so it can burn/mint 1155 during wrap/unwrap
        CallToken token = CallToken(callTokenAddr);
        bytes32 MINTER = token.MINTER_ROLE();
        token.grantRole(MINTER, address(wrapper));

        vm.stopBroadcast();

        console2.log("CallTokenWrapper:    ", address(wrapper));
    }
}