// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ante} from "../src/Ante.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract AnteTest is Test {
    Ante internal ante;
    MockERC20 internal token;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal mod = makeAddr("mod");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant MIN_STAKE = 25e4; // 0.25 of a 6-decimal token
    uint256 internal constant WINDOW = 1 days;
    bytes32 internal constant TOPIC = keccak256("ante-test-topic");

    function setUp() public {
        token = new MockERC20("pathUSD", "pUSD", 6);
        vm.prank(owner);
        ante = new Ante(IERC20(address(token)), treasury, MIN_STAKE, WINDOW, owner);

        // fund actors and approve the contract generously
        for (uint256 i; i < 2; ++i) {
            address who = i == 0 ? alice : bob;
            token.mint(who, 1_000e6);
            vm.prank(who);
            token.approve(address(ante), type(uint256).max);
        }
    }

    function _post(address who, string memory content, uint256 stake) internal returns (uint256 id) {
        vm.prank(who);
        id = ante.post(TOPIC, stake, content);
    }

    // ---------------------------------------------------------------- post

    function test_post_storesAndPullsStake() public {
        uint256 balBefore = token.balanceOf(alice);
        uint256 id = _post(alice, "hello world", MIN_STAKE);

        assertEq(id, 1, "first id is 1");
        (address author, uint96 stake, uint64 postedAt, Ante.Status status, bytes32 h, uint256 tips) =
            ante.comments(id);
        assertEq(author, alice);
        assertEq(stake, uint96(MIN_STAKE));
        assertEq(postedAt, uint64(block.timestamp));
        assertEq(uint8(status), uint8(Ante.Status.Active));
        assertEq(h, keccak256(bytes("hello world")), "content hash");
        assertEq(tips, 0);
        assertEq(token.balanceOf(alice), balBefore - MIN_STAKE, "pulled exactly stake");
        assertEq(token.balanceOf(address(ante)), MIN_STAKE, "escrowed");
    }

    function test_post_incrementsId() public {
        assertEq(_post(alice, "a", MIN_STAKE), 1);
        assertEq(_post(bob, "b", MIN_STAKE), 2);
        assertEq(_post(alice, "c", MIN_STAKE), 3);
        assertEq(ante.nextId(), 3);
    }

    function test_post_revertsBelowMinStake() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ante.StakeBelowMinimum.selector, MIN_STAKE - 1, MIN_STAKE));
        ante.post(TOPIC, MIN_STAKE - 1, "too cheap");
    }

    function test_post_emitsContentInEvent() public {
        vm.expectEmit(true, true, true, true, address(ante));
        emit Ante.Posted(1, TOPIC, alice, keccak256(bytes("gm")), "gm", MIN_STAKE, uint64(block.timestamp));
        _post(alice, "gm", MIN_STAKE);
    }

    // ------------------------------------------------------------ withdraw

    function test_withdraw_afterWindow() public {
        uint256 id = _post(alice, "keeper", MIN_STAKE);
        uint256 balBefore = token.balanceOf(alice);

        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        ante.withdraw(id);

        (, , , Ante.Status status, , ) = ante.comments(id);
        assertEq(uint8(status), uint8(Ante.Status.Withdrawn));
        assertEq(token.balanceOf(alice), balBefore + MIN_STAKE, "stake returned");
        assertEq(token.balanceOf(address(ante)), 0);
    }

    function test_withdraw_revertsBeforeWindow() public {
        uint256 id = _post(alice, "early", MIN_STAKE);
        vm.warp(block.timestamp + WINDOW - 1);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(Ante.WindowNotElapsed.selector, uint256(uint64(block.timestamp)) + 1)
        );
        ante.withdraw(id);
    }

    function test_withdraw_revertsForNonAuthor() public {
        uint256 id = _post(alice, "mine", MIN_STAKE);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(bob);
        vm.expectRevert(Ante.NotAuthor.selector);
        ante.withdraw(id);
    }

    function test_withdraw_revertsIfNotActive() public {
        uint256 id = _post(alice, "twice", MIN_STAKE);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        ante.withdraw(id);
        vm.prank(alice);
        vm.expectRevert(Ante.NotActive.selector);
        ante.withdraw(id);
    }

    // --------------------------------------------------------------- slash

    function test_slash_byModeratorRoutesToTreasury() public {
        uint256 id = _post(alice, "spam", MIN_STAKE);
        uint256 tBefore = token.balanceOf(treasury);

        vm.prank(owner); // owner is seeded as moderator
        ante.slash(id, "spam");

        (, , , Ante.Status status, , ) = ante.comments(id);
        assertEq(uint8(status), uint8(Ante.Status.Slashed));
        assertEq(token.balanceOf(treasury), tBefore + MIN_STAKE, "treasury got the stake");
        assertEq(token.balanceOf(address(ante)), 0);
    }

    function test_slash_revertsForNonModerator() public {
        uint256 id = _post(alice, "x", MIN_STAKE);
        vm.prank(bob);
        vm.expectRevert(Ante.NotModerator.selector);
        ante.slash(id, "nope");
    }

    function test_slash_revertsIfNotActive() public {
        uint256 id = _post(alice, "x", MIN_STAKE);
        vm.prank(owner);
        ante.slash(id, "first");
        vm.prank(owner);
        vm.expectRevert(Ante.NotActive.selector);
        ante.slash(id, "again");
    }

    function test_slash_blocksWithdraw() public {
        uint256 id = _post(alice, "bad", MIN_STAKE);
        vm.prank(owner);
        ante.slash(id, "bad");
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        vm.expectRevert(Ante.NotActive.selector);
        ante.withdraw(id);
    }

    function test_addedModeratorCanSlash() public {
        uint256 id = _post(alice, "y", MIN_STAKE);
        vm.prank(owner);
        ante.setModerator(mod, true);
        vm.prank(mod);
        ante.slash(id, "by new mod");
        (, , , Ante.Status status, , ) = ante.comments(id);
        assertEq(uint8(status), uint8(Ante.Status.Slashed));
    }

    // ----------------------------------------------------------------- tip

    function test_tip_routesToAuthor() public {
        uint256 id = _post(alice, "good take", MIN_STAKE);
        uint256 aBefore = token.balanceOf(alice);

        vm.prank(bob);
        ante.tip(id, 5e6);

        assertEq(token.balanceOf(alice), aBefore + 5e6, "author received tip");
        (, , , , , uint256 tips) = ante.comments(id);
        assertEq(tips, 5e6, "tip accounted");
    }

    function test_tip_worksAfterWithdraw() public {
        uint256 id = _post(alice, "still tippable", MIN_STAKE);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        ante.withdraw(id);

        uint256 aBefore = token.balanceOf(alice);
        vm.prank(bob);
        ante.tip(id, 1e6);
        assertEq(token.balanceOf(alice), aBefore + 1e6);
    }

    function test_tip_revertsOnZero() public {
        uint256 id = _post(alice, "z", MIN_STAKE);
        vm.prank(bob);
        vm.expectRevert(Ante.ZeroAmount.selector);
        ante.tip(id, 0);
    }

    function test_tip_revertsUnknownComment() public {
        vm.prank(bob);
        vm.expectRevert(Ante.UnknownComment.selector);
        ante.tip(999, 1e6);
    }

    // ---------------------------------------------------------------- flag

    function test_flag_movesToChallengedAndEscrowsBond() public {
        uint256 id = _post(alice, "flagme", MIN_STAKE);
        vm.prank(bob);
        ante.flag(id, MIN_STAKE, "off-topic");

        (, , , Ante.Status status, , ) = ante.comments(id);
        assertEq(uint8(status), uint8(Ante.Status.Challenged), "flag opens a challenge");
        (address flagger, uint96 bond, , bool open) = ante.challenges(id);
        assertEq(flagger, bob);
        assertEq(bond, uint96(MIN_STAKE));
        assertTrue(open);
        assertEq(ante.totalEscrowed(), 2 * MIN_STAKE, "comment stake + flag bond");
    }

    function test_flag_revertsUnknownComment() public {
        vm.prank(bob);
        vm.expectRevert(Ante.UnknownComment.selector);
        ante.flag(42, MIN_STAKE, "ghost");
    }

    // --------------------------------------------------------------- admin

    function test_admin_setters() public {
        vm.startPrank(owner);
        ante.setMinStake(1e6);
        ante.setChallengeWindow(2 days);
        ante.setTreasury(bob);
        ante.setModerator(mod, true);
        vm.stopPrank();

        assertEq(ante.minStake(), 1e6);
        assertEq(ante.challengeWindow(), 2 days);
        assertEq(ante.treasury(), bob);
        assertTrue(ante.moderators(mod));
    }

    function test_admin_onlyOwner() public {
        vm.prank(bob);
        vm.expectRevert(); // OZ Ownable: OwnableUnauthorizedAccount
        ante.setMinStake(1);
    }

    function test_setTreasury_revertsZero() public {
        vm.prank(owner);
        vm.expectRevert(Ante.ZeroAddress.selector);
        ante.setTreasury(address(0));
    }

    // ----------------------------------------------------- views / fuzz

    function test_isWithdrawable_transitions() public {
        uint256 id = _post(alice, "w", MIN_STAKE);
        assertFalse(ante.isWithdrawable(id), "not before window");
        vm.warp(block.timestamp + WINDOW);
        assertTrue(ante.isWithdrawable(id), "ok after window");
        vm.prank(alice);
        ante.withdraw(id);
        assertFalse(ante.isWithdrawable(id), "not after withdraw");
    }

    function testFuzz_post_pullsExactStake(uint256 stake) public {
        stake = bound(stake, MIN_STAKE, 1_000e6);
        uint256 balBefore = token.balanceOf(alice);
        _post(alice, "fuzz", stake);
        assertEq(token.balanceOf(alice), balBefore - stake);
        assertEq(token.balanceOf(address(ante)), stake);
    }

    function test_constructor_revertsZeroAddresses() public {
        vm.expectRevert(Ante.ZeroAddress.selector);
        new Ante(IERC20(address(0)), treasury, MIN_STAKE, WINDOW, owner);
        vm.expectRevert(Ante.ZeroAddress.selector);
        new Ante(IERC20(address(token)), address(0), MIN_STAKE, WINDOW, owner);
    }
}
