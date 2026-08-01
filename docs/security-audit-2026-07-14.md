# Ante — Security Audit (2026-07-14)

Internal adversarial audit of `contracts/src/Ante.sol` (the money contract escrowing real
pathUSD on Tempo mainnet), reviewed at the post-`GHSA-qp2h` state (`main`, commit `ba10d9b`),
**before the planned v2 redeploy**.

## Methodology

Four independent reviewers, each with a distinct expert lens over the full contract, plus tooling:

1. **Fund safety** — reentrancy / CEI / value conservation / token-transfer correctness.
2. **Access control** — every privileged path, owner blast radius, ownership/moderator lifecycle.
3. **Arithmetic & bounds** — casts, bps math, limits, struct packing, overflow.
4. **Economics & lifecycle** — state machine, flag/resolveFlag, incentives, MEV/front-running.
5. **Slither** static analysis (full run) + the existing `forge` suite.

## Verdict

**No critical or high-severity _code_ vulnerability. No theft or fund-conservation bug** — every
fund-moving function is `nonReentrant` with strict checks-effects-interactions, and escrow
(`totalEscrowed`) reconciles exactly on every path (verified by hand on all branches **and** by a
new fuzz-invariant: `balanceOf == totalEscrowed` held over 128,000 randomized calls). Slither is
clean bar two benign `timestamp` infos.

The real exposure is **(a) the single-key trust model** (an operational item, dominant risk on a
live deployment) and **(b) liveness/timing** around the optimistic-challenge flow. The sharpest of
these (F12) is fixed in this pass.

## Severity summary

| ID | Sev | Title | Status |
|----|-----|-------|--------|
| H1 | High (operational) | Single key is owner **+ moderator + treasury** → a compromised key can seize existing escrow | **Recommendation** (separate keys before redeploy) |
| F12 | Medium | No withdrawal finality: `flag` can front-run `withdraw` repeatably | **Fixed** — `flag` gated to the window |
| F13 | Low | `post` has no window cap → front-run `setChallengeWindow` locks an in-flight post (≤30d) | Recommendation |
| F14 | Low | Forfeited grief-bond pays treasury, not the harmed author | Recommendation |
| A1 | Low | `transferOwnership` doesn't revoke the old owner's moderator bit | Recommendation |
| F-A | Low | Author can flag their own comment | **Fixed** — `SelfFlag` guard (shown non-profitable) |
| I1 | Info | `setMinFlagBond` reverts a mislabeled error | **Fixed** — `InvalidMinFlagBond` |
| I2 | Info | `tip` records gross, not received (display only) | Accepted (no fund impact) |
| I3 | Info | No sweep/recovery for stray tokens | Accepted (a no-rug feature) |
| I4 | Info | Outbound-fee/rebasing `stakeToken` would break conservation | Documented assumption |

## Findings

### H1 · High (operational) — single-key owner/moderator/treasury seizes existing escrow
The deployed owner is a single EOA that is **also** the treasury and the seeded moderator. A
compromised owner key can `setTreasury(attacker)` then `slash`/`resolveFlag`-uphold **every live
comment** (a pending `withdraw` is a straight race against `slash`), converting essentially all
escrow into attacker-controlled funds — no user interaction, no timelock. This is not a code bug
(the modifiers are all correct); it's the trust concentration.
**Recommendation before redeploy:** split the roles — owner → a multisig or timelock; moderator →
a distinct operational key; treasury → a separately-controlled address; and stop auto-seeding the
owner as moderator, so a lone compromised admin key can't slash. (For a solo operator: a timelock
owner + a hot moderator key + a cold treasury, ideally all on a hardware wallet, achieves this
without a co-signer — see the discussion in the PR thread.)

### F12 · Medium — withdrawal finality (FIXED)
`flag` only checked `status == Active`, not the window, so an `Active` comment was
*simultaneously* withdrawable and flaggable in `[postedAt+windowSecs, ∞)`. Anyone could front-run
an author's `withdraw` with a bond, flip it to `Challenged`, and (on reject → back to `Active`)
re-flag the next attempt — an on-demand, repeatable DoS on any specific stake (self-limiting, as
each cycle burns the griefer's bond, but it defeats the "your stake comes back" promise).
**Fix:** `flag` now reverts `ChallengeWindowClosed` once `block.timestamp >= postedAt + windowSecs`
— challenges can only be opened *within* the window, removing the overlap entirely. Test:
`test_flag_revertsAfterWindow`.

### F13 · Low — in-flight `post` window slippage
A new `post` snapshots the *live* global `challengeWindow`; a malicious owner could front-run it
with `setChallengeWindow(30d)` to lock a stake the poster didn't agree to (bounded to 30d by the
`GHSA-qp2h` cap, and moot once H1's key separation lands).
**Recommendation:** optional `post(topic, stake, content, uint64 maxWindow)` slippage guard.
(Deferred here to avoid an ABI change to the hottest function for a largely-mitigated Low.)

### F14 · Low — forfeited grief-bond routes to treasury, not the harmed author
On a rejected (frivolous) flag, the bond goes to `treasury` while the author (whose stake was
locked) gets nothing. Under H1 (owner = treasury = moderator), the adjudicator profits from
rejected flags and from *holding* challenged funds — a mild incentive not to resolve promptly.
**Recommendation:** route a share of the forfeited bond to the flagged author, paired with a
resolution-timeout auto-reject (below).

### A1 · Low — stale moderator after ownership transfer
The moderator mapping is independent of `Ownable`. After `transferOwnership`, the **old** owner
keeps `moderators[old] == true` (full slash/seize power) until `setModerator(old, false)` is
called manually, and the new owner isn't a moderator until it adds itself. Documentation-only
safeguard, no test.
**Recommendation:** an atomic `rotateOwner` (revoke old moderator, grant new) or a transfer-time
checklist + regression test.

### Liveness (known, unbounded) — moderator-stranding for in-window challenges
For a challenge opened legitimately *within* the window, there is still no timeout: `flaggedAt` is
stored but never read, so a negligent moderator can strand the author's stake indefinitely. F12
removes the *post-window* griefing; this residual needs a **resolution-timeout auto-reject** (use
the stored `flaggedAt`; a permissionless call returns the comment to `Active` and settles the bond
after, say, N days). **Recommended** as a follow-up.

### Fixed Info items
- **I1:** `setMinFlagBond` now reverts `InvalidMinFlagBond` (was `InvalidMinStake`). Test: `test_setMinFlagBond_bounds`.
- **F-A:** `flag` now reverts `SelfFlag` if `msg.sender == c.author`. (The economics reviewer showed self-flagging is a *loss* for the author absent moderator collusion, so this is hygiene, not a closed exploit.) Test: `test_flag_revertsSelfFlag`.

### Accepted / documented
- **I2** `tip` display counter is gross (not fee-adjusted) — display-only, un-escrowed, no accounting impact.
- **I3** no `sweep` — stray/airdropped tokens are permanently locked; arguably a feature (no owner rug vector).
- **I4** the balance-delta pattern handles inbound fee-on-transfer; an *outbound*-fee or rebasing `stakeToken` would break conservation. The deployed token is a fixed standard stablecoin — **do not point `stakeToken` at an exotic fee/rebasing token.**

## Changes landed in this pass
`flag` window-finality gate (F12) + self-flag guard (F-A) + `InvalidMinFlagBond` (I1), and a new
**fuzz-invariant** (`balanceOf == totalEscrowed`) plus unit tests. **58 tests pass** (55 + 3);
invariant: 256 runs / 128,000 calls / 0 reverts.

## Before the mainnet redeploy
1. **Separate owner / moderator / treasury keys (H1)** — the single most important item.
2. Consider the **resolution-timeout auto-reject** (+ F14 bond split) to close the liveness gap.
3. Optional: `post` `maxWindow` slippage (F13); `rotateOwner` (A1).

## On an external audit
A third-party firm audit ($30k+) is disproportionate for ~$0.25 stakes. If external validation is
still wanted, proportionate options are a small **bug bounty** (e.g. Immunefi) or a short
**audit-contest** (Code4rena/Sherlock/Cantina) — but for this scale, this internal audit + Slither
in CI + the invariant/58-test suite is a reasonable bar. The dominant residual risk is H1
(operational), not code.
