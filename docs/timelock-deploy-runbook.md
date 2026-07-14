# Ante — two-key + timelock redeploy runbook

This is the **v2 redeploy** (the window-snapshot Ante) wired into the two-key model:

- **Owner = a TimelockController.** Every admin knob (`setChallengeWindow`, `setTreasury`,
  `setModerator`, fees) is delayed by `TIMELOCK_DELAY` and can be vetoed during the delay.
- **Moderator = a separate hot key.** `slash` / `resolveFlag` stay **instant** — real moderation
  always lands inside the challenge window.
- **Treasury = a separate cold address** (receive-only).
- **Proposer** queues admin ops; **Guardian** can *only* cancel them; anyone may execute after the delay.

Script: [`contracts/script/DeployTimelock.s.sol`](../contracts/script/DeployTimelock.s.sol) ·
tests: [`contracts/test/Timelock.t.sol`](../contracts/test/Timelock.t.sol).

## 0. Keys you need (four distinct addresses)

| Env | Role | Keep it… | Notes |
|-----|------|----------|-------|
| `PROPOSER` | queues admin changes | **cold** (hardware wallet) | your main admin key |
| `GUARDIAN` | can *only cancel* pending changes | **separate** device from PROPOSER | the "hit the brakes" key; one theft must not get both |
| `MODERATOR` | `slash`/`resolveFlag`, instant | hot but protected (hardware wallet ok) | day-to-day moderation |
| `TREASURY` | receives slashed/forfeited funds + fees | **cold**, receive-only | never needs to sign |

The **deployer** account (the one running the script, e.g. your `ante-deployer` keystore) is only a
*temporary* admin during the script and renounces it at the end — no backdoor is left.

## 1. Parameters (Tempo mainnet)

```sh
export STAKE_TOKEN=0x20c0000000000000000000000000000000000000   # pathUSD (6dp)
export MIN_STAKE=250000                                          # 0.25 pathUSD
export CHALLENGE_WINDOW=604800                                   # 7 days (matches v1)
export TIMELOCK_DELAY=691200                                     # 8 days — MUST be >= CHALLENGE_WINDOW
export TIP_FEE_BPS=1000                                          # 10% (matches v1)
export PROPOSER=0xYourColdAdminKey
export GUARDIAN=0xYourSeparateCancelKey
export MODERATOR=0xYourHotModeratorKey
export TREASURY=0xYourColdTreasury
```

> **Why `TIMELOCK_DELAY >= CHALLENGE_WINDOW`** (the script `require`s it): so any locked stake can
> unlock and be withdrawn *before* a queued change can land. 8 days > the 7-day window gives a day
> of margin. (See `docs/security-audit-2026-07-14.md` and the timelock discussion.)

## 2. Dry-run, then deploy

```sh
cd contracts
# simulate (no broadcast) — check the console output addresses/roles
forge script script/DeployTimelock.s.sol --rpc-url https://rpc.tempo.xyz --account ante-deployer

# broadcast for real (signs with the ante-deployer keystore)
forge script script/DeployTimelock.s.sol --rpc-url https://rpc.tempo.xyz --account ante-deployer --broadcast
```

Record the printed **Ante** and **Timelock** addresses.

## 3. Verify on-chain

```sh
# owner is the timelock
cast call $ANTE "owner()(address)" --rpc-url https://rpc.tempo.xyz          # == the Timelock

# moderation wiring
cast call $ANTE "moderators(address)(bool)" $MODERATOR --rpc-url ...        # true
cast call $ANTE "moderators(address)(bool)" $DEPLOYER  --rpc-url ...        # false (dropped)

# timelock roles
cast call $TIMELOCK "getMinDelay()(uint256)" --rpc-url ...                  # == TIMELOCK_DELAY
# PROPOSER has PROPOSER_ROLE; GUARDIAN has CANCELLER_ROLE; deployer has NO DEFAULT_ADMIN_ROLE
```

## 4. Cut the frontend over

- Point the blog embed (`burntbytes [params.ante]`) at the **new** Ante address — the embed is
  chain-agnostic, no rebuild.
- Regenerate `web/src/abi/Ante.json` from the v2 build (the `comments()` getter gained `windowSecs`,
  and there are new errors). The feed reads events, so this is low-impact, but keep the ABI current.
- Leave v1 (`0x547C…9676`) readable; its (tiny) stakes drain as authors withdraw. New comments go to v2.

## 5. Making an admin change afterward (e.g. change a fee)

Admin changes now take two steps + the delay:

```sh
DATA=$(cast calldata "setTipFeeBps(uint256)" 500)
# 1) queue it (PROPOSER key)
cast send $TIMELOCK "schedule(address,uint256,bytes,bytes32,bytes32,uint256)" \
  $ANTE 0 $DATA 0x0 0x1 $TIMELOCK_DELAY --account proposer --rpc-url ...
# 2) after TIMELOCK_DELAY, execute (anyone)
cast send $TIMELOCK "execute(address,uint256,bytes,bytes32,bytes32)" \
  $ANTE 0 $DATA 0x0 0x1 --account proposer --rpc-url ...
```

**To veto a pending change** (e.g. you see one you didn't authorize), with the GUARDIAN key:

```sh
ID=$(cast call $TIMELOCK "hashOperation(address,uint256,bytes,bytes32,bytes32)" $ANTE 0 $DATA 0x0 0x1 --rpc-url ...)
cast send $TIMELOCK "cancel(bytes32)" $ID --account guardian --rpc-url ...
```

Moderation (`slash`/`resolveFlag`) is **not** timelocked — call it directly with the MODERATOR key.

## 6. Key hygiene

Put `PROPOSER`, `GUARDIAN`, and `TREASURY` on hardware wallets, and keep `PROPOSER` and `GUARDIAN`
on **different** devices (so a single theft can't both queue and prevent-cancel). See the
hardware-wallet notes shared alongside this runbook.
