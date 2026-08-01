// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ante} from "../src/Ante.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fuzzed handler driving randomized lifecycles. Each action is wrapped in
///         try/catch so an invalid draw (wrong status, closed window, etc.) is simply
///         a no-op rather than aborting the campaign — the invariant is what we assert.
contract AnteHandler is Test {
    Ante public ante;
    MockERC20 public token;
    address public owner;
    address[] internal actors;
    uint256[] internal ids;

    constructor(Ante _ante, MockERC20 _token, address _owner, address[] memory _actors) {
        ante = _ante;
        token = _token;
        owner = _owner;
        actors = _actors;
    }

    function _actor(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function post(uint256 actorSeed, uint256 stakeSeed) external {
        uint256 stake = bound(stakeSeed, ante.minStake(), 10e6);
        vm.prank(_actor(actorSeed));
        try ante.post(keccak256("t"), stake, "c") returns (uint256 id) {
            ids.push(id);
        } catch {}
    }

    function withdraw(uint256 idSeed, uint256 warpSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        vm.warp(block.timestamp + bound(warpSeed, 0, 2 days));
        (address author,,,,,,) = ante.comments(id);
        vm.prank(author);
        try ante.withdraw(id) {} catch {}
    }

    function slash(uint256 idSeed) external {
        if (ids.length == 0) return;
        vm.prank(owner);
        try ante.slash(ids[idSeed % ids.length], "x") {} catch {}
    }

    function flag(uint256 idSeed, uint256 actorSeed) external {
        if (ids.length == 0) return;
        vm.prank(_actor(actorSeed));
        try ante.flag(ids[idSeed % ids.length], ante.minFlagBond(), "f") {} catch {}
    }

    function resolve(uint256 idSeed, bool uphold) external {
        if (ids.length == 0) return;
        vm.prank(owner);
        try ante.resolveFlag(ids[idSeed % ids.length], uphold, "r") {} catch {}
    }

    function tip(uint256 idSeed, uint256 actorSeed, uint256 amtSeed) external {
        if (ids.length == 0) return;
        vm.prank(_actor(actorSeed));
        try ante.tip(ids[idSeed % ids.length], bound(amtSeed, 1, 5e6)) {} catch {}
    }
}

/// @notice Invariant: the contract's token balance always equals `totalEscrowed`
///         (live stakes + open bonds) across any randomized action sequence — the
///         conservation property the fund-safety audit traced by hand.
contract AnteInvariantTest is Test {
    Ante internal ante;
    MockERC20 internal token;
    AnteHandler internal handler;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        token = new MockERC20("pathUSD", "pUSD", 6);
        vm.prank(owner);
        ante = new Ante(IERC20(address(token)), treasury, 25e4, 1 days, owner);

        address[] memory actors = new address[](3);
        actors[0] = makeAddr("a");
        actors[1] = makeAddr("b");
        actors[2] = makeAddr("c");
        for (uint256 i; i < actors.length; ++i) {
            token.mint(actors[i], 1_000e6);
            vm.prank(actors[i]);
            token.approve(address(ante), type(uint256).max);
        }

        handler = new AnteHandler(ante, token, owner, actors);
        targetContract(address(handler));
    }

    function invariant_escrowSolvent() public view {
        assertEq(token.balanceOf(address(ante)), ante.totalEscrowed(), "balance == totalEscrowed");
    }
}
