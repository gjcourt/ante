# Ante.sol — security review & fixes

Adversarial review of the money-handling contract (escrows stablecoin stakes), 2026-06-11. Findings below; **Status** notes what was fixed in response. Tests for each fix live in `contracts/test/AnteHardening.t.sol`.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | **HIGH** | Fee-on-transfer / rebasing token breaks escrow accounting: `post` recorded the *requested* stake but pulled via `transferFrom`, so a fee token under-funds escrow and one comment's withdrawal/slash can drain another's stake (single commingled balance). | **FIXED** — `post` now measures the **actual received** amount via balance-delta and credits/escrows that; `received` re-checked against `minStake` and the `uint96` cap. |
| F2 | Low | `minStake` could be set to 0 or above `uint96.max`, bricking posting. | **FIXED** — constructor + `setMinStake` enforce `0 < minStake ≤ uint96.max` (`InvalidMinStake`). |
| F3 | Medium (design) | No aggregate escrow accounting → no defense-in-depth against drift. | **FIXED** — `totalEscrowed` tracked on post/withdraw/slash; `test_escrowIsolation_mixedLifecycle` asserts contract balance == sum of live stakes. |
| F4 | Info | Double-withdraw / withdraw↔slash / double-slash. | **Confirmed safe** (CEI + `nonReentrant` + terminal status set before transfer). Added the missing withdraw→slash test. |
| F5 | Info | Reentrancy / CEI. | **Pass** — all fund-moving fns `nonReentrant`, effects before interactions; `flag` has no external call. |
| F6 | Medium (access) | `renounceOwnership` would permanently freeze treasury/moderator admin; owner stays moderator after `transferOwnership`. | **FIXED** — `renounceOwnership` overridden to revert (`OwnershipCannotBeRenounced`); owner-as-moderator-after-transfer documented in NatSpec. |
| F7 | Info | Removed moderator replay. | **Pass** — `onlyModerator` reads live mapping. Added `test_removedModerator_cannotSlash`. |
| F8 | Low | `flag` on dead comments = harmless event-log noise. | Accepted (no fund impact; `slash` reverts on `!Active`). |
| F9 | Low | `minStake = 0` would disable Sybil resistance. | **FIXED** via F2 (non-zero floor enforced). |
| F10 | Info | `block.timestamp` window manipulation. | **Pass** — irrelevant at day-scale windows. |
| F11 | Info | Token assumptions. | SafeERC20 handles missing-return / return-false / revert. Fee-on-transfer now handled (F1). Decimals fine (`uint96` holds 6-dp stablecoin amounts comfortably). |

## Verdict

Original: *conditionally safe for testnet; not safe for an arbitrary ERC-20 until F1 fixed.* **After fixes: the F1 fee-on-transfer drain is closed and proven by `test_feeToken_creditsReceivedAndIsolatesEscrow`.** Still recommended before mainnet: a professional audit.

## Addendum — staked flagging (`flag` + `resolveFlag`)

The optimistic-challenge mechanism was subsequently implemented (was "future work" above). Same security posture applied to the new fund-moving paths:
- `flag` credits the bond by **balance-delta** (fee-on-transfer safe, same as `post`), is `nonReentrant`, and bounds the bond to `uint96`. Test: `test_flag_feeToken_creditsReceivedBond`.
- `resolveFlag` is `nonReentrant` + `onlyModerator`, sets terminal state and zeroes the open challenge **before** any transfer (CEI), and conserves funds exactly: upheld pays `bond + bounty` to flagger and `stake − bounty` to treasury (`= bond + stake` in, decremented from `totalEscrowed`); rejected forfeits `bond` to treasury. `flagBountyBps`/`tipFeeBps` are bounded `≤ 10_000`.
- **Open liveness item (documented, not a vuln):** a Challenged comment locks the author's stake until the moderator resolves; a negligent moderator could strand funds. Mitigation (resolution-timeout auto-reject) is noted in `SPEC.md`, out of MVP scope.

**52/52 tests pass** (25 core + 12 hardening + 15 staked-flag). Full lifecycle including both resolve paths verified on a live anvil node.

## Addendum — challenge-window snapshot (GHSA-qp2h)

A later critique sweep found that `withdraw` computed the unlock as `postedAt + challengeWindow` using the **live** global, and `setChallengeWindow` was **unbounded** — so the owner (or a compromised owner key) could retroactively extend the lock on every outstanding stake indefinitely (real-funds liveness foot-gun on the live mainnet deployment).

**FIXED (v2):** each comment now snapshots the window in effect at post time (`Comment.windowSecs`), and `withdraw`/`isWithdrawable` use that snapshot — so `setChallengeWindow` only affects **future** posts and can never retroactively lock existing funds. `setChallengeWindow` (and the constructor) are bounded to `MAX_CHALLENGE_WINDOW = 30 days`. Tests: `test_setChallengeWindow_doesNotRetroLockExistingStakes`, `test_setChallengeWindow_rejectsOutOfBounds`, `test_constructor_rejectsOutOfBoundsWindow`. **This is a new contract (v2) — it requires a redeploy + migration; the live v1 at `0x547C…9676` still carries the original behavior until migrated.**

**55/55 tests pass.** The single-key owner/treasury/moderator concentration (tracked in the GitHub advisories) remains an operational item independent of this code fix.
