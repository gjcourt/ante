// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ante} from "../src/Ante.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockFeeERC20} from "../src/mocks/MockFeeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Tests added in response to the adversarial security review:
///         fee-on-transfer accounting (F1), escrow isolation (F3), min-stake
///         bounds (F2/F9), renounce protection (F6), removed-moderator (F7),
///         and the coverage gaps it flagged.
contract AnteHardeningTest is Test {
    Ante internal ante;
    MockERC20 internal token;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal mod = makeAddr("mod");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant MIN_STAKE = 25e4;
    uint256 internal constant WINDOW = 1 days;
    bytes32 internal constant TOPIC = keccak256("ante-test-topic");

    function setUp() public {
        token = new MockERC20("pathUSD", "pUSD", 6);
        vm.prank(owner);
        ante = new Ante(IERC20(address(token)), treasury, MIN_STAKE, WINDOW, owner);
        address[3] memory actors = [alice, bob, carol];
        for (uint256 i; i < actors.length; ++i) {
            token.mint(actors[i], 1_000e6);
            vm.prank(actors[i]);
            token.approve(address(ante), type(uint256).max);
        }
    }

    function _post(address who, string memory c, uint256 s) internal returns (uint256 id) {
        vm.prank(who);
        id = ante.post(TOPIC, s, c);
    }

    // ---- F1: fee-on-transfer credits actual received, no cross-comment drain

    function test_feeToken_creditsReceivedAndIsolatesEscrow() public {
        // 1% fee token. Stake 100e6 sent -> 99e6 actually received & credited.
        MockFeeERC20 fee = new MockFeeERC20("feeUSD", "fUSD", 6, 100);
        Ante a = new Ante(IERC20(address(fee)), treasury, MIN_STAKE, WINDOW, owner);

        fee.mint(alice, 1_000e6);
        fee.mint(bob, 1_000e6);
        vm.prank(alice);
        fee.approve(address(a), type(uint256).max);
        vm.prank(bob);
        fee.approve(address(a), type(uint256).max);

        vm.prank(alice);
        uint256 id1 = a.post(TOPIC, 100e6, "alice");
        (, uint96 stake1, , , , ) = a.comments(id1);
        assertEq(stake1, 99e6, "credited received (post-fee), not requested");
        assertEq(a.totalEscrowed(), 99e6);
        assertEq(fee.balanceOf(address(a)), 99e6, "contract holds exactly what it credited");

        vm.prank(bob);
        uint256 id2 = a.post(TOPIC, 100e6, "bob");
        assertEq(a.totalEscrowed(), 198e6);

        // Alice withdraws: she gets her 99e6 back (minus the token's own transfer
        // fee on the way out), and crucially Bob's escrow is untouched.
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        a.withdraw(id1);
        assertEq(a.totalEscrowed(), 99e6, "only alice's escrow removed");
        // Bob can still fully withdraw — no drain occurred.
        vm.prank(bob);
        a.withdraw(id2);
        assertEq(a.totalEscrowed(), 0);
        (, , , Ante.Status s2, , ) = a.comments(id2);
        assertEq(uint8(s2), uint8(Ante.Status.Withdrawn));
    }

    // ---- F3: escrow isolation across mixed withdraw/slash/active

    function test_escrowIsolation_mixedLifecycle() public {
        uint256 a = _post(alice, "a", MIN_STAKE);
        uint256 b = _post(bob, "b", MIN_STAKE);
        _post(carol, "c", MIN_STAKE); // stays Active
        assertEq(ante.totalEscrowed(), 3 * MIN_STAKE);

        vm.prank(owner);
        ante.slash(a, "spam");
        vm.warp(block.timestamp + WINDOW);
        vm.prank(bob);
        ante.withdraw(b);

        // one Active comment remains; contract balance must equal exactly its stake
        assertEq(ante.totalEscrowed(), MIN_STAKE, "carol's stake remains");
        assertEq(token.balanceOf(address(ante)), MIN_STAKE, "balance matches escrow exactly");
    }

    // ---- F2/F9: min-stake bounds

    function test_constructor_rejectsZeroMinStake() public {
        vm.expectRevert(Ante.InvalidMinStake.selector);
        new Ante(IERC20(address(token)), treasury, 0, WINDOW, owner);
    }

    function test_constructor_rejectsHugeMinStake() public {
        vm.expectRevert(Ante.InvalidMinStake.selector);
        new Ante(IERC20(address(token)), treasury, uint256(type(uint96).max) + 1, WINDOW, owner);
    }

    function test_setMinStake_bounds() public {
        vm.prank(owner);
        vm.expectRevert(Ante.InvalidMinStake.selector);
        ante.setMinStake(0);
        vm.prank(owner);
        vm.expectRevert(Ante.InvalidMinStake.selector);
        ante.setMinStake(uint256(type(uint96).max) + 1);
    }

    // ---- StakeTooLarge (was untested)

    function test_post_revertsStakeTooLarge() public {
        // raise allowance/balance conceptually; uint96 max + 1 as stake
        uint256 huge = uint256(type(uint96).max) + 1;
        token.mint(alice, huge);
        vm.prank(alice);
        vm.expectRevert(Ante.StakeTooLarge.selector);
        ante.post(TOPIC, huge, "too big");
    }

    // ---- F6: renounce blocked

    function test_renounceOwnership_reverts() public {
        vm.prank(owner);
        vm.expectRevert(Ante.OwnershipCannotBeRenounced.selector);
        ante.renounceOwnership();
        assertEq(ante.owner(), owner, "still owned");
    }

    // ---- F7: removed moderator is blocked

    function test_removedModerator_cannotSlash() public {
        uint256 id = _post(alice, "x", MIN_STAKE);
        vm.startPrank(owner);
        ante.setModerator(mod, true);
        vm.stopPrank();
        // works while modded
        uint256 id2 = _post(bob, "y", MIN_STAKE);
        vm.prank(mod);
        ante.slash(id2, "ok");
        // revoke -> blocked
        vm.prank(owner);
        ante.setModerator(mod, false);
        vm.prank(mod);
        vm.expectRevert(Ante.NotModerator.selector);
        ante.slash(id, "blocked now");
    }

    // ---- coverage gaps: withdraw->slash, unknown ids

    function test_withdrawThenSlash_reverts() public {
        uint256 id = _post(alice, "x", MIN_STAKE);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        ante.withdraw(id);
        vm.prank(owner);
        vm.expectRevert(Ante.NotActive.selector);
        ante.slash(id, "too late");
    }

    function test_withdraw_unknownId_reverts() public {
        vm.prank(alice);
        vm.expectRevert(Ante.UnknownComment.selector);
        ante.withdraw(123);
    }

    function test_slash_unknownId_reverts() public {
        vm.prank(owner);
        vm.expectRevert(Ante.UnknownComment.selector);
        ante.slash(123, "ghost");
    }

    function test_tip_onSlashedComment_routesToAuthor() public {
        uint256 id = _post(alice, "x", MIN_STAKE);
        vm.prank(owner);
        ante.slash(id, "bad");
        uint256 before = token.balanceOf(alice);
        vm.prank(bob);
        ante.tip(id, 1e6);
        assertEq(token.balanceOf(alice), before + 1e6, "tip still reaches author");
    }
}
