// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ante} from "../src/Ante.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockFeeERC20} from "../src/mocks/MockFeeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Staked-flagging / optimistic-challenge mechanism: flag posts a bond,
///         moderator resolves, upheld pays the flagger a bounty + refund and
///         routes the remainder to treasury, rejected forfeits the bond.
contract AnteFlagTest is Test {
    Ante internal ante;
    MockERC20 internal token;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal author = makeAddr("author");
    address internal flagger = makeAddr("flagger");
    address internal rando = makeAddr("rando");

    uint256 internal constant MIN = 25e4; // 0.25 (6-dp)
    uint256 internal constant WINDOW = 1 days;
    bytes32 internal constant TOPIC = keccak256("ante-test-topic");

    function setUp() public {
        token = new MockERC20("pathUSD", "pUSD", 6);
        vm.prank(owner);
        ante = new Ante(IERC20(address(token)), treasury, MIN, WINDOW, owner);
        address[3] memory actors = [author, flagger, rando];
        for (uint256 i; i < actors.length; ++i) {
            token.mint(actors[i], 1_000e6);
            vm.prank(actors[i]);
            token.approve(address(ante), type(uint256).max);
        }
    }

    function _post() internal returns (uint256 id) {
        vm.prank(author);
        id = ante.post(TOPIC, MIN, "a comment");
    }

    function _flag(uint256 id) internal {
        vm.prank(flagger);
        ante.flag(id, MIN, "spam");
    }

    // ---- defaults wired in constructor

    function test_defaults() public view {
        assertEq(ante.minFlagBond(), MIN, "flag bond defaults to minStake (symmetric)");
        assertEq(ante.flagBountyBps(), 5_000, "50% bounty default");
        assertEq(ante.tipFeeBps(), 0, "no tip fee by default");
    }

    // ---- flag mechanics

    function test_flag_blocksWithdraw() public {
        uint256 id = _post();
        _flag(id);
        vm.warp(block.timestamp + WINDOW + 1);
        vm.prank(author);
        vm.expectRevert(Ante.NotActive.selector); // Challenged != Active
        ante.withdraw(id);
    }

    function test_flag_revertsBelowMinBond() public {
        uint256 id = _post();
        vm.prank(flagger);
        vm.expectRevert(abi.encodeWithSelector(Ante.BondBelowMinimum.selector, MIN - 1, MIN));
        ante.flag(id, MIN - 1, "cheap");
    }

    function test_flag_cannotDoubleChallenge() public {
        uint256 id = _post();
        _flag(id);
        vm.prank(rando);
        vm.expectRevert(Ante.NotActive.selector);
        ante.flag(id, MIN, "again");
    }

    // ---- resolve: upheld

    function test_resolve_upheld_paysBountyAndRefund() public {
        uint256 id = _post();
        uint256 flaggerStart = token.balanceOf(flagger);
        _flag(id); // flagger now down MIN (bond escrowed)
        assertEq(ante.totalEscrowed(), 2 * MIN, "stake + bond");

        uint256 tBefore = token.balanceOf(treasury);
        vm.prank(owner);
        ante.resolveFlag(id, true, "confirmed spam");

        // bounty = 50% of stake; flagger gets bond back + bounty; treasury gets remainder
        uint256 bounty = MIN / 2;
        assertEq(token.balanceOf(flagger), flaggerStart + bounty, "net gain == bounty");
        assertEq(token.balanceOf(treasury), tBefore + (MIN - bounty), "treasury gets stake remainder");
        (, , , Ante.Status status, , ) = ante.comments(id);
        assertEq(uint8(status), uint8(Ante.Status.Slashed));
        assertEq(ante.totalEscrowed(), 0, "all escrow released");
        assertEq(token.balanceOf(address(ante)), 0, "contract empty");
    }

    // ---- resolve: rejected

    function test_resolve_rejected_forfeitsBond_authorWithdraws() public {
        uint256 id = _post();
        uint256 flaggerStart = token.balanceOf(flagger);
        _flag(id);

        uint256 tBefore = token.balanceOf(treasury);
        vm.prank(owner);
        ante.resolveFlag(id, false, "comment is fine");

        assertEq(token.balanceOf(flagger), flaggerStart - MIN, "flagger forfeits the bond");
        assertEq(token.balanceOf(treasury), tBefore + MIN, "bond -> treasury");
        (, , , Ante.Status status, , ) = ante.comments(id);
        assertEq(uint8(status), uint8(Ante.Status.Active), "comment vindicated");
        assertEq(ante.totalEscrowed(), MIN, "only the comment stake remains");

        // author can now withdraw after the window
        vm.warp(block.timestamp + WINDOW + 1);
        uint256 aBefore = token.balanceOf(author);
        vm.prank(author);
        ante.withdraw(id);
        assertEq(token.balanceOf(author), aBefore + MIN);
        assertEq(ante.totalEscrowed(), 0);
    }

    function test_reflag_afterRejection() public {
        uint256 id = _post();
        _flag(id);
        vm.prank(owner);
        ante.resolveFlag(id, false, "fine");
        // back to Active -> can be flagged again
        vm.prank(rando);
        ante.flag(id, MIN, "second look");
        (, , , Ante.Status status, , ) = ante.comments(id);
        assertEq(uint8(status), uint8(Ante.Status.Challenged));
    }

    // ---- resolve auth / state

    function test_resolve_onlyModerator() public {
        uint256 id = _post();
        _flag(id);
        vm.prank(rando);
        vm.expectRevert(Ante.NotModerator.selector);
        ante.resolveFlag(id, true, "nope");
    }

    function test_resolve_revertsWithoutOpenChallenge() public {
        uint256 id = _post();
        vm.prank(owner);
        vm.expectRevert(Ante.NoOpenChallenge.selector);
        ante.resolveFlag(id, true, "none open");
    }

    function test_resolve_doubleResolveReverts() public {
        uint256 id = _post();
        _flag(id);
        vm.prank(owner);
        ante.resolveFlag(id, true, "first");
        vm.prank(owner);
        vm.expectRevert(Ante.NoOpenChallenge.selector);
        ante.resolveFlag(id, true, "again");
    }

    // ---- bounty bps variants

    function test_resolve_fullBounty() public {
        vm.prank(owner);
        ante.setFlagBountyBps(10_000); // flagger takes the whole slashed stake
        uint256 id = _post();
        uint256 tBefore = token.balanceOf(treasury);
        uint256 flaggerStart = token.balanceOf(flagger);
        _flag(id);
        vm.prank(owner);
        ante.resolveFlag(id, true, "max bounty");
        assertEq(token.balanceOf(flagger), flaggerStart + MIN, "net gain == full stake");
        assertEq(token.balanceOf(treasury), tBefore, "treasury gets nothing");
    }

    function test_setFlagBountyBps_revertsAboveMax() public {
        vm.prank(owner);
        vm.expectRevert(Ante.InvalidBps.selector);
        ante.setFlagBountyBps(10_001);
    }

    // ---- tip fee split

    function test_tipFee_splitsToTreasury() public {
        vm.prank(owner);
        ante.setTipFeeBps(1_000); // 10%
        uint256 id = _post();

        uint256 aBefore = token.balanceOf(author);
        uint256 tBefore = token.balanceOf(treasury);
        vm.prank(rando);
        ante.tip(id, 10e6);

        assertEq(token.balanceOf(author), aBefore + 9e6, "author gets 90%");
        assertEq(token.balanceOf(treasury), tBefore + 1e6, "treasury gets 10%");
    }

    function test_setTipFeeBps_revertsAboveMax() public {
        vm.prank(owner);
        vm.expectRevert(Ante.InvalidBps.selector);
        ante.setTipFeeBps(10_001);
    }

    // ---- fee-on-transfer flag bond is credited by balance delta

    function test_flag_feeToken_creditsReceivedBond() public {
        MockFeeERC20 fee = new MockFeeERC20("feeUSD", "fUSD", 6, 100); // 1%
        Ante a = new Ante(IERC20(address(fee)), treasury, MIN, WINDOW, owner);
        fee.mint(author, 1_000e6);
        fee.mint(flagger, 1_000e6);
        vm.prank(author);
        fee.approve(address(a), type(uint256).max);
        vm.prank(flagger);
        fee.approve(address(a), type(uint256).max);

        vm.prank(author);
        uint256 id = a.post(TOPIC, 100e6, "c"); // credits 99e6
        vm.prank(flagger);
        a.flag(id, 100e6, "spam"); // bond credited 99e6, not 100e6
        (, uint96 bond, , bool open) = a.challenges(id);
        assertEq(bond, 99e6, "bond credited net of fee");
        assertTrue(open);
        assertEq(a.totalEscrowed(), 198e6, "99 stake + 99 bond");
    }
}
