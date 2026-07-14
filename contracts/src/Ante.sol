// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Ante — pseudonymous pay-to-comment with stake-and-slash
/// @notice To comment you post a refundable stablecoin stake. Flagging is also
///         staked: a flagger bonds funds to challenge a comment. A moderator
///         resolves the challenge — if upheld, the comment is slashed and the
///         flagger is refunded plus a bounty from the slashed stake; if
///         rejected, the flagger's bond is forfeited to the treasury. After a
///         challenge window with no open challenge, the author reclaims the
///         stake. Symmetric skin-in-the-game: speaking and accusing both cost.
/// @dev    The stake token is any ERC-20 stablecoin (TIP-20 on Tempo is
///         ERC-20 compatible). Comment text lives only in the `Posted` event;
///         on-chain we keep just keccak256(content) as an integrity anchor.
contract Ante is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    uint256 private constant BPS_DENOMINATOR = 10_000;

    enum Status {
        Active,
        Withdrawn,
        Slashed,
        Challenged // a staked flag is open; withdrawal blocked until resolved
    }

    struct Comment {
        address author; // pseudonymous embedded-wallet address
        uint96 stake; // staked amount, token's smallest unit
        uint64 postedAt; // block.timestamp at post
        uint64 windowSecs; // challengeWindow snapshotted at post time (packs w/ postedAt+status)
        Status status;
        bytes32 contentHash; // keccak256(bytes(content))
        uint256 tips; // cumulative tips routed to author (display only)
    }

    struct Challenge {
        address flagger; // who staked to challenge
        uint96 bond; // flagger's escrowed bond
        uint64 flaggedAt;
        bool open; // true while awaiting moderator resolution
    }

    IERC20 public immutable stakeToken;
    address public treasury; // receives slashed stakes, forfeited bonds, tip fees
    uint256 public minStake; // minimum to post
    uint256 public minFlagBond; // minimum bond to flag (defaults to minStake — symmetric)
    uint256 public flagBountyBps; // share of a slashed stake paid to the upholding flagger
    uint256 public tipFeeBps; // share of each tip routed to treasury/gas-pool (default 0)
    uint256 public constant MAX_CHALLENGE_WINDOW = 30 days; // upper bound: no comment can be locked longer
    uint256 public challengeWindow; // seconds before withdrawal unlocks (snapshotted per comment at post)
    uint256 public nextId; // monotonic id; first posted comment is id 1
    uint256 public totalEscrowed; // all user funds held: live stakes + open flag bonds

    mapping(uint256 => Comment) public comments;
    mapping(uint256 => Challenge) public challenges;
    mapping(address => bool) public moderators;

    event Posted(
        uint256 indexed id,
        bytes32 indexed topic, // per-thread scope (e.g. keccak of a blog-post slug)
        address indexed author,
        bytes32 contentHash,
        string content,
        uint256 stake,
        uint64 postedAt
    );
    event Withdrawn(uint256 indexed id, address indexed author, uint256 stake);
    event Slashed(uint256 indexed id, address indexed author, uint256 stake, string reason);
    event Tipped(uint256 indexed id, address indexed from, address indexed author, uint256 amount, uint256 fee);
    event Flagged(uint256 indexed id, address indexed flagger, uint256 bond, string reason);
    event FlagResolved(uint256 indexed id, address indexed flagger, bool upheld, uint256 bounty, string reason);

    event MinStakeSet(uint256 minStake);
    event MinFlagBondSet(uint256 minFlagBond);
    event FlagBountyBpsSet(uint256 flagBountyBps);
    event TipFeeBpsSet(uint256 tipFeeBps);
    event ChallengeWindowSet(uint256 challengeWindow);
    event TreasurySet(address treasury);
    event ModeratorSet(address indexed moderator, bool allowed);

    error StakeBelowMinimum(uint256 provided, uint256 required);
    error BondBelowMinimum(uint256 provided, uint256 required);
    error StakeTooLarge(); // must fit in uint96
    error InvalidMinStake(); // must be > 0 and <= uint96 max
    error InvalidChallengeWindow(); // must be > 0 and <= MAX_CHALLENGE_WINDOW
    error InvalidBps(); // must be <= 10_000
    error OwnershipCannotBeRenounced();
    error NotAuthor();
    error NotModerator();
    error NotActive();
    error ChallengeOpen();
    error NoOpenChallenge();
    error WindowNotElapsed(uint256 unlocksAt);
    error ZeroAmount();
    error ZeroAddress();
    error UnknownComment();

    modifier onlyModerator() {
        if (!moderators[msg.sender]) revert NotModerator();
        _;
    }

    /// @param _stakeToken      ERC-20 stablecoin used for stakes
    /// @param _treasury        recipient of slashed stakes
    /// @param _minStake        minimum stake required to post
    /// @param _challengeWindow seconds the moderator can slash before withdrawal unlocks
    /// @param _owner           contract owner (admin); also seeded as a moderator
    constructor(
        IERC20 _stakeToken,
        address _treasury,
        uint256 _minStake,
        uint256 _challengeWindow,
        address _owner
    ) Ownable(_owner) {
        if (address(_stakeToken) == address(0) || _treasury == address(0) || _owner == address(0)) {
            revert ZeroAddress();
        }
        if (_minStake == 0 || _minStake > type(uint96).max) revert InvalidMinStake();
        if (_challengeWindow == 0 || _challengeWindow > MAX_CHALLENGE_WINDOW) revert InvalidChallengeWindow();
        stakeToken = _stakeToken;
        treasury = _treasury;
        minStake = _minStake;
        challengeWindow = _challengeWindow;
        // Defaults (owner-adjustable): symmetric flag bond, 50% bounty, no tip fee.
        minFlagBond = _minStake;
        flagBountyBps = 5_000;
        tipFeeBps = 0;
        moderators[_owner] = true;
        emit TreasurySet(_treasury);
        emit MinStakeSet(_minStake);
        emit MinFlagBondSet(_minStake);
        emit FlagBountyBpsSet(5_000);
        emit TipFeeBpsSet(0);
        emit ChallengeWindowSet(_challengeWindow);
        emit ModeratorSet(_owner, true);
    }

    // ------------------------------------------------------------------
    // Core
    // ------------------------------------------------------------------

    /// @notice Post a comment under `topic`, escrowing `stake` of the stake token.
    /// @param  topic   per-thread scope. The frontend uses keccak256(post-slug)
    ///                 so each blog article has its own comment thread; it is
    ///                 indexed in the `Posted` event for cheap RPC-side filtering
    ///                 and is otherwise opaque to the contract (not stored).
    /// @dev    Pulls `stake` via transferFrom; caller must have approved this
    ///         contract for at least `stake` beforehand. The amount actually
    ///         credited is measured from the contract's balance delta, so a
    ///         fee-on-transfer / rebasing token cannot under-fund escrow and let
    ///         one comment's payout drain another's stake. `nonReentrant` guards
    ///         the pre-effects external call.
    function post(bytes32 topic, uint256 stake, string calldata content)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (stake < minStake) revert StakeBelowMinimum(stake, minStake);

        // Pull first, then credit only what actually arrived (fee-on-transfer safe).
        uint256 balBefore = stakeToken.balanceOf(address(this));
        stakeToken.safeTransferFrom(msg.sender, address(this), stake);
        uint256 received = stakeToken.balanceOf(address(this)) - balBefore;

        if (received < minStake) revert StakeBelowMinimum(received, minStake);
        if (received > type(uint96).max) revert StakeTooLarge();

        id = ++nextId;
        uint64 ts = uint64(block.timestamp);
        bytes32 h = keccak256(bytes(content));

        comments[id] = Comment({
            author: msg.sender,
            // safe: `received > type(uint96).max` reverted above with StakeTooLarge
            // forge-lint: disable-next-line(unsafe-typecast)
            stake: uint96(received),
            postedAt: ts,
            // snapshot the window in effect NOW; a later setChallengeWindow can't move it.
            // safe cast: challengeWindow is bounded to MAX_CHALLENGE_WINDOW (30 days, fits uint64).
            // forge-lint: disable-next-line(unsafe-typecast)
            windowSecs: uint64(challengeWindow),
            status: Status.Active,
            contentHash: h,
            tips: 0
        });
        totalEscrowed += received;

        emit Posted(id, topic, msg.sender, h, content, received, ts);
    }

    /// @notice Author reclaims their stake once the challenge window elapses.
    function withdraw(uint256 id) external nonReentrant {
        Comment storage c = comments[id];
        if (c.author == address(0)) revert UnknownComment();
        if (msg.sender != c.author) revert NotAuthor();
        if (c.status != Status.Active) revert NotActive();
        uint256 unlocksAt = uint256(c.postedAt) + c.windowSecs; // per-comment snapshot, not the live global
        if (block.timestamp < unlocksAt) revert WindowNotElapsed(unlocksAt);

        uint256 amount = c.stake;
        c.status = Status.Withdrawn;
        totalEscrowed -= amount;

        stakeToken.safeTransfer(c.author, amount);
        emit Withdrawn(id, c.author, amount);
    }

    /// @notice Moderator slashes an active comment; its stake goes to treasury.
    function slash(uint256 id, string calldata reason) external nonReentrant onlyModerator {
        Comment storage c = comments[id];
        if (c.author == address(0)) revert UnknownComment();
        if (c.status != Status.Active) revert NotActive();

        uint256 amount = c.stake;
        address author = c.author;
        c.status = Status.Slashed;
        totalEscrowed -= amount;

        stakeToken.safeTransfer(treasury, amount);
        emit Slashed(id, author, amount, reason);
    }

    /// @notice Tip a comment's author in the stake token. Works in any status.
    /// @dev    If `tipFeeBps > 0`, that share is routed to the treasury (a gas /
    ///         operations pool); the remainder goes to the author. Default is 0
    ///         so tips reach the author in full.
    function tip(uint256 id, uint256 amount) external nonReentrant {
        Comment storage c = comments[id];
        if (c.author == address(0)) revert UnknownComment();
        if (amount == 0) revert ZeroAmount();

        c.tips += amount;
        address author = c.author;
        uint256 fee = (amount * tipFeeBps) / BPS_DENOMINATOR;
        uint256 toAuthor = amount - fee;

        if (toAuthor > 0) stakeToken.safeTransferFrom(msg.sender, author, toAuthor);
        if (fee > 0) stakeToken.safeTransferFrom(msg.sender, treasury, fee);
        emit Tipped(id, msg.sender, author, amount, fee);
    }

    /// @notice Stake a bond to challenge an active comment. Moves it to
    ///         `Challenged` (blocking the author's withdrawal) until a moderator
    ///         resolves it. One open challenge per comment at a time.
    /// @dev    Bond is credited by balance-delta (fee-on-transfer safe), like
    ///         post(). Symmetric with posting: accusing costs skin too.
    function flag(uint256 id, uint256 bond, string calldata reason) external nonReentrant {
        Comment storage c = comments[id];
        if (c.author == address(0)) revert UnknownComment();
        if (c.status != Status.Active) revert NotActive(); // also blocks a second open challenge
        if (bond < minFlagBond) revert BondBelowMinimum(bond, minFlagBond);

        uint256 balBefore = stakeToken.balanceOf(address(this));
        stakeToken.safeTransferFrom(msg.sender, address(this), bond);
        uint256 received = stakeToken.balanceOf(address(this)) - balBefore;

        if (received < minFlagBond) revert BondBelowMinimum(received, minFlagBond);
        if (received > type(uint96).max) revert StakeTooLarge();

        challenges[id] = Challenge({
            flagger: msg.sender,
            // safe: bounded by the StakeTooLarge check above
            // forge-lint: disable-next-line(unsafe-typecast)
            bond: uint96(received),
            flaggedAt: uint64(block.timestamp),
            open: true
        });
        c.status = Status.Challenged;
        totalEscrowed += received;

        emit Flagged(id, msg.sender, received, reason);
    }

    /// @notice Moderator resolves an open challenge.
    /// @param uphold true = comment is bad: slash it, refund the flagger's bond
    ///        plus a bounty (`flagBountyBps` of the comment stake), remainder to
    ///        treasury. false = comment is fine: the flagger forfeits their bond
    ///        to the treasury and the comment returns to Active.
    function resolveFlag(uint256 id, bool uphold, string calldata reason) external nonReentrant onlyModerator {
        Challenge storage ch = challenges[id];
        if (!ch.open) revert NoOpenChallenge();
        Comment storage c = comments[id];

        address flagger = ch.flagger;
        uint256 bond = ch.bond;
        ch.open = false; // effect before interactions

        if (uphold) {
            uint256 s = c.stake;
            address author = c.author;
            c.status = Status.Slashed;
            uint256 bounty = (s * flagBountyBps) / BPS_DENOMINATOR;
            if (bounty > s) bounty = s; // defensive; bps <= 10_000 already guarantees this
            totalEscrowed -= (s + bond);

            stakeToken.safeTransfer(flagger, bond + bounty); // bond back + reward
            uint256 toTreasury = s - bounty;
            if (toTreasury > 0) stakeToken.safeTransfer(treasury, toTreasury);

            emit Slashed(id, author, s, reason);
            emit FlagResolved(id, flagger, true, bounty, reason);
        } else {
            c.status = Status.Active; // vindicated; author may withdraw after the window
            totalEscrowed -= bond;

            stakeToken.safeTransfer(treasury, bond); // forfeited
            emit FlagResolved(id, flagger, false, 0, reason);
        }
    }

    // ------------------------------------------------------------------
    // Admin (onlyOwner)
    // ------------------------------------------------------------------

    function setMinStake(uint256 _minStake) external onlyOwner {
        if (_minStake == 0 || _minStake > type(uint96).max) revert InvalidMinStake();
        minStake = _minStake;
        emit MinStakeSet(_minStake);
    }

    function setMinFlagBond(uint256 _minFlagBond) external onlyOwner {
        if (_minFlagBond == 0 || _minFlagBond > type(uint96).max) revert InvalidMinStake();
        minFlagBond = _minFlagBond;
        emit MinFlagBondSet(_minFlagBond);
    }

    function setFlagBountyBps(uint256 _flagBountyBps) external onlyOwner {
        if (_flagBountyBps > BPS_DENOMINATOR) revert InvalidBps();
        flagBountyBps = _flagBountyBps;
        emit FlagBountyBpsSet(_flagBountyBps);
    }

    function setTipFeeBps(uint256 _tipFeeBps) external onlyOwner {
        if (_tipFeeBps > BPS_DENOMINATOR) revert InvalidBps();
        tipFeeBps = _tipFeeBps;
        emit TipFeeBpsSet(_tipFeeBps);
    }

    /// @dev Disabled: renouncing ownership would permanently freeze `treasury`,
    ///      `minStake`, `challengeWindow`, and moderator management. If owner
    ///      rotation is needed, use `transferOwnership` (and remember to revoke
    ///      the prior owner's moderator role via `setModerator`).
    function renounceOwnership() public view override onlyOwner {
        revert OwnershipCannotBeRenounced();
    }

    /// @notice Set the challenge window for FUTURE posts only. Existing comments keep the window
    ///         snapshotted at their post time, so this can never retroactively lock staked funds.
    ///         Bounded by MAX_CHALLENGE_WINDOW so no post can be locked indefinitely.
    function setChallengeWindow(uint256 _challengeWindow) external onlyOwner {
        if (_challengeWindow == 0 || _challengeWindow > MAX_CHALLENGE_WINDOW) revert InvalidChallengeWindow();
        challengeWindow = _challengeWindow;
        emit ChallengeWindowSet(_challengeWindow);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    function setModerator(address moderator, bool allowed) external onlyOwner {
        if (moderator == address(0)) revert ZeroAddress();
        moderators[moderator] = allowed;
        emit ModeratorSet(moderator, allowed);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Whether `id`'s author can withdraw right now.
    function isWithdrawable(uint256 id) external view returns (bool) {
        Comment storage c = comments[id];
        return c.author != address(0) && c.status == Status.Active
            && block.timestamp >= uint256(c.postedAt) + c.windowSecs;
    }
}
