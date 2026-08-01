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

## ✅ Deployed (2026-08-01) — verified

| | Ante | Timelock (owner) | block | window / delay |
|---|---|---|---|---|
| **Mainnet** (4217) | `0xf18b1e9c3e2d7324d768d6728032107759366736` | `0xf755586bce6d99d825ac946f73a365ae641a49a8` | 32704748 | 604800 / 691200 |
| Testnet (Moderato 42431) | `0x0ce1da48b5bde0ed1c426b225751e7c335935e89` | `0x0141a9bb9d680aae7304d9e67874772150fe03c1` | 28959077 | 60 / 120 |

Roles both chains: PROPOSER=`0xC8Fa…f21f` (Trezor), GUARDIAN=`0x53f4…6d17`, MODERATOR=`0x8496…0c4f`,
TREASURY=`0xb13c…6666` (cold), deployer=`0xf3f07B…36a7` (throwaway, renounced everything).
Mainnet **supersedes v1 `0x547C…9676`** (neutralized). All `owner()==Timelock` / moderator-bit /
role checks passed (§3).

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

Use the `make deploy-timelock` target — it bakes in the two Tempo-specific fixes below.
Run the broadcast in a **real terminal** (the keystore password prompt needs a TTY; an
in-session/`!` runner fails with `Device not configured`).

```sh
# simulate (no broadcast, no password) — check the printed addresses/roles + gas
cd contracts && forge script script/DeployTimelock.s.sol:DeployTimelock \
  --rpc-url https://rpc.tempo.xyz --sender <DEPLOYER_ADDR> \
  # (with STAKE_TOKEN/TREASURY/MIN_STAKE/CHALLENGE_WINDOW/TIMELOCK_DELAY/PROPOSER/GUARDIAN/MODERATOR env set)

# broadcast for real (signs with the throwaway deployer keystore)
make deploy-timelock RPC_URL=https://rpc.tempo.xyz \
  PROPOSER=0x… GUARDIAN=0x… MODERATOR=0x… TREASURY=0x… \
  TIMELOCK_DELAY=691200 CHALLENGE_WINDOW=604800 \
  ACCOUNT=deployer SENDER=<DEPLOYER_ADDR>
```

**Two forge-on-Tempo gotchas the target handles (both cost a failed attempt otherwise):**
- **`SENDER=` is required with `ACCOUNT=`/`TREZOR=`** — forge can't derive the broadcasting
  address from an encrypted keystore before the password is entered and aborts on its
  default-sender guard (`You seem to be using Foundry's default sender`).
- **`--gas-estimate-multiplier 800` (baked in via `GAS_MULT`)** — forge estimates a *multi-tx*
  script by local EVM simulation (standard gas) because each tx depends on the previous one's
  not-yet-onchain state; Tempo's TIP-1000 create costs (1000 gas/byte, 250k/slot) run ~5.5× that,
  so the creates OOG without the bump. 8× covers it and stays under the 30M per-tx block cap.

The **DEPLOYER (signer) MUST differ from MODERATOR** — the script drops the deployer's
auto-seeded moderator bit, which would cancel out an intended moderator==deployer. Record the
printed **Ante** and **Timelock** addresses.

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

**Client approval model (know this before launch):** the first post from a passkey wallet is
**two confirmations** — an ERC-20 `approve` then the `post` — and the app approves an **infinite**
allowance (`maxUint256`), so every post after that is a **single** confirmation. The tradeoff: each
commenter's wallet grants Ante permission to pull *all* its pathUSD, not just the stake. That's the
standard dapp pattern (the alternative — re-approving every comment — is worse UX), and it's low-risk
here: `post()` only ever pulls the exact `minStake`, the contract is covered by the security review +
52 tests, and these are throwaway comment wallets holding just enough to stake. Worth a sentence in
the launch post if it touches "what you're trusting."

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
