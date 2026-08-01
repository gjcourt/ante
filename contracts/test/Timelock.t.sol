// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Ante} from "../src/Ante.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Verifies the two-key deployment: Ante owned by a TimelockController (admin ops delayed +
///         cancellable), a separate hot moderator (instant slash), and a cancel-only guardian.
///         Mirrors script/DeployTimelock.s.sol.
contract TimelockTest is Test {
    Ante internal ante;
    TimelockController internal timelock;
    MockERC20 internal token;

    address internal proposer = makeAddr("proposer");
    address internal guardian = makeAddr("guardian");
    address internal moderator = makeAddr("moderator");
    address internal treasury = makeAddr("treasury");
    address internal author = makeAddr("author");
    address internal rando = makeAddr("rando");

    uint256 internal constant MIN = 25e4;
    uint256 internal constant WINDOW = 1 days;
    uint256 internal constant DELAY = 1 days; // >= WINDOW
    bytes32 internal constant TOPIC = keccak256("t");
    bytes32 internal constant SALT = bytes32(uint256(1));

    function setUp() public {
        token = new MockERC20("pathUSD", "pUSD", 6);

        // --- mirror DeployTimelock: this test contract is the temporary deployer/admin ---
        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory executors = new address[](1);
        executors[0] = address(0); // open executor
        timelock = new TimelockController(DELAY, proposers, executors, address(this));
        timelock.grantRole(timelock.CANCELLER_ROLE(), guardian);

        ante = new Ante(IERC20(address(token)), treasury, MIN, WINDOW, address(this));
        ante.setModerator(moderator, true);
        ante.setModerator(address(this), false);
        ante.transferOwnership(address(timelock));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        token.mint(author, 1_000e6);
        vm.prank(author);
        token.approve(address(ante), type(uint256).max);
    }

    function _post() internal returns (uint256 id) {
        vm.prank(author);
        id = ante.post(TOPIC, MIN, "c");
    }

    function test_timelock_ownsAnte() public view {
        assertEq(ante.owner(), address(timelock));
        assertFalse(ante.moderators(address(this)), "deployer moderator dropped");
        assertTrue(ante.moderators(moderator), "hot moderator set");
    }

    // ---- moderation is INSTANT (not timelocked)

    function test_moderator_slashesInstantly() public {
        uint256 id = _post();
        vm.prank(moderator);
        ante.slash(id, "spam"); // no scheduling, no delay
        (,,,, Ante.Status status,,) = ante.comments(id);
        assertEq(uint8(status), uint8(Ante.Status.Slashed));
        assertEq(token.balanceOf(treasury), MIN, "slash routed to treasury");
    }

    function test_deployerCannotSlashOrAdmin() public {
        uint256 id = _post();
        vm.expectRevert(Ante.NotModerator.selector); // deployer was removed as moderator
        ante.slash(id, "x");
        // and the deployer renounced timelock admin — cannot grant itself a role
        bytes32 propRole = timelock.PROPOSER_ROLE(); // cache: keep the view call out of expectRevert
        vm.expectRevert();
        timelock.grantRole(propRole, address(this));
    }

    // ---- admin knobs are DELAYED + go through the timelock

    function _sched(bytes memory data) internal returns (bytes32 id) {
        vm.prank(proposer);
        timelock.schedule(address(ante), 0, data, bytes32(0), SALT, DELAY);
        id = timelock.hashOperation(address(ante), 0, data, bytes32(0), SALT);
    }

    function test_adminChange_requiresDelayThenExecutes() public {
        bytes memory data = abi.encodeCall(Ante.setChallengeWindow, (2 hours));
        _sched(data);

        // not executable before the delay elapses
        vm.expectRevert();
        timelock.execute(address(ante), 0, data, bytes32(0), SALT);

        vm.warp(block.timestamp + DELAY);
        timelock.execute(address(ante), 0, data, bytes32(0), SALT); // open executor: anyone
        assertEq(ante.challengeWindow(), 2 hours, "admin change applied after the delay");
    }

    function test_nonProposerCannotSchedule() public {
        bytes memory data = abi.encodeCall(Ante.setChallengeWindow, (2 hours));
        vm.prank(rando);
        vm.expectRevert();
        timelock.schedule(address(ante), 0, data, bytes32(0), SALT, DELAY);
    }

    // ---- the guardian can VETO a pending op (the "react" mechanism)

    function test_guardian_cancelsPendingOp() public {
        bytes memory data = abi.encodeCall(Ante.setTreasury, (rando));
        bytes32 id = _sched(data);
        assertTrue(timelock.isOperationPending(id));

        vm.prank(guardian);
        timelock.cancel(id); // guardian's only power

        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(); // cancelled -> never executable
        timelock.execute(address(ante), 0, data, bytes32(0), SALT);
        assertEq(ante.treasury(), treasury, "treasury unchanged");
    }

    function test_nonGuardianCannotCancel() public {
        bytes memory data = abi.encodeCall(Ante.setTreasury, (rando));
        bytes32 id = _sched(data);
        vm.prank(rando);
        vm.expectRevert();
        timelock.cancel(id);
    }
}
