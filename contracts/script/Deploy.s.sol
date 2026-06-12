// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Ante} from "../src/Ante.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploy Ante to Tempo testnet.
///
/// Required env vars:
///   STAKE_TOKEN      stake-token (stablecoin) address — Tempo testnet pathUSD:
///                    0x20c0000000000000000000000000000000000000 (6 decimals)
///   TREASURY         recipient of slashed stakes
///   MIN_STAKE        minimum stake in token's smallest unit (e.g. 250000 = 0.25 pathUSD)
///   CHALLENGE_WINDOW seconds before withdrawal unlocks (e.g. 86400 = 1 day)
///   OWNER            admin/owner address (also seeded as a moderator)
///
/// Run (Tempo testnet — fees paid in stablecoins, no native token):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY
///
/// Note: Tempo's state-creation gas is ~12x higher than mainnet Ethereum, and
/// the deployer wallet must hold a fee stablecoin (e.g. pathUSD from the faucet).
contract Deploy is Script {
    function run() external returns (Ante ante) {
        address stakeToken = vm.envAddress("STAKE_TOKEN");
        address treasury = vm.envAddress("TREASURY");
        uint256 minStake = vm.envUint("MIN_STAKE");
        uint256 challengeWindow = vm.envUint("CHALLENGE_WINDOW");
        address owner = vm.envAddress("OWNER");

        vm.startBroadcast();
        ante = new Ante(IERC20(stakeToken), treasury, minStake, challengeWindow, owner);
        vm.stopBroadcast();

        console2.log("Ante deployed at:", address(ante));
        console2.log("  stakeToken:", stakeToken);
        console2.log("  treasury:", treasury);
        console2.log("  minStake:", minStake);
        console2.log("  challengeWindow:", challengeWindow);
        console2.log("  owner:", owner);
    }
}
