// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Ante} from "../src/Ante.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DeployTimelock — Ante (v2) under a two-key model with a TimelockController owner.
/// @notice Roles after this script runs:
///   - OWNER (admin) = the TimelockController. Every admin knob (setChallengeWindow, setTreasury,
///     setModerator, fees) is delayed by TIMELOCK_DELAY and can be vetoed during the delay.
///   - MODERATOR = a separate hot key. `slash`/`resolveFlag` stay INSTANT (no timelock), so real
///     moderation always lands inside the challenge window.
///   - TREASURY = a separate (cold) address; only ever receives funds.
///   - PROPOSER queues admin ops; GUARDIAN can ONLY cancel them; anyone may execute after the delay.
/// @dev The deployer is a *temporary* timelock admin (to grant the guardian its cancel-only role and
///      do the one-time Ante config instantly) and renounces that admin at the end — no backdoor left.
contract DeployTimelock is Script {
    function run() external returns (Ante ante, TimelockController timelock) {
        address stakeToken = vm.envAddress("STAKE_TOKEN");
        address treasury = vm.envAddress("TREASURY");
        uint256 minStake = vm.envUint("MIN_STAKE");
        uint256 window = vm.envUint("CHALLENGE_WINDOW");
        uint256 delay = vm.envUint("TIMELOCK_DELAY");
        address proposer = vm.envAddress("PROPOSER");
        address guardian = vm.envAddress("GUARDIAN");
        address moderator = vm.envAddress("MODERATOR");
        uint256 tipFeeBps = vm.envOr("TIP_FEE_BPS", uint256(1000));

        // The one rule that makes the timelock actually protect locked stakes: a stolen owner key can
        // only *announce* a change, and every locked stake can unlock + withdraw before it lands.
        require(delay >= window, "TIMELOCK_DELAY must be >= CHALLENGE_WINDOW");
        require(proposer != address(0) && guardian != address(0) && moderator != address(0), "zero role");
        require(guardian != proposer, "guardian must be a separate key from proposer");

        vm.startBroadcast();
        address deployer = msg.sender;

        // 1) Timelock. Deployer is a temporary admin so it can grant the guardian a cancel-only role.
        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // open executor: anyone can execute a matured (already-vetted) op
        timelock = new TimelockController(delay, proposers, executors, deployer);

        // Guardian gets CANCELLER_ROLE only — it can veto a pending op, and can do nothing else.
        timelock.grantRole(timelock.CANCELLER_ROLE(), guardian);

        // 2) Ante with owner = deployer (temporarily) so the one-time config below is instant.
        ante = new Ante(IERC20(stakeToken), treasury, minStake, window, deployer);

        // 3) One-time config while the deployer still owns it (no timelock delay yet):
        if (tipFeeBps != 0) ante.setTipFeeBps(tipFeeBps);
        ante.setModerator(moderator, true); // the hot moderator key
        ante.setModerator(deployer, false); // drop the auto-seeded deployer moderator

        // 4) Hand ownership to the timelock. From here, admin changes need the delay + are cancellable.
        ante.transferOwnership(address(timelock));

        // 5) Drop the deployer's temporary timelock admin — the timelock now self-administers only.
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), deployer);

        vm.stopBroadcast();

        console2.log("Ante            :", address(ante));
        console2.log("Timelock (owner):", address(timelock));
        console2.log("delay (seconds) :", delay);
        console2.log("proposer        :", proposer);
        console2.log("guardian/cancel :", guardian);
        console2.log("moderator (hot) :", moderator);
        console2.log("treasury (cold) :", treasury);
    }
}
