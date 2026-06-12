# Ante

**Pseudonymous pay-to-comment with stake-and-slash, on the Tempo blockchain.**

To comment, you post a small **refundable stablecoin stake**. If your comment isn't flagged-and-removed during a challenge window, you reclaim the stake (and can earn tips). If a moderator slashes it, the stake goes to a treasury. No account, no real identity — just a passkey-backed embedded wallet. **The bond is the reputation system, priced in dollars instead of karma points.**

This is an MVP / learning build and a concrete demonstration of stablecoin micropayments as a sybil-resistance primitive. See [`SPEC.md`](./SPEC.md) for the full design and [`docs/tempo-facts.md`](./docs/tempo-facts.md) for the verified Tempo testnet config.

## Layout

| Dir | What | Status |
|---|---|---|
| `contracts/` | Foundry project: `Ante.sol`, mocks, tests, deploy + local-e2e scripts | ✅ builds, **52/52 tests pass**; full lifecycle (incl. staked flag → resolve) verified on a live node (anvil) |
| `web/` | Vite + React + TS comment widget (viem + embedded wallet) | ✅ builds clean (tsc + vite) |
| `server/` | Minimal Turnkey backend (passkey → sub-org + wallet) | ✅ typechecks + boots; passkey wiring needs creds |
| `docs/` | `tempo-facts.md` — verified chain/wallet config | ✅ |

The contract was hardened after an adversarial security review — see `docs/security-review.md` for findings and fixes (fee-on-transfer escrow accounting, min-stake bounds, renounce protection, escrow isolation).

## How it works

1. Reader writes a comment, approves the stake token, calls `post(stake, content)`. Stake is escrowed; the comment text is emitted in the `Posted` event (content lives off-chain in logs; only `keccak256(content)` is stored on-chain).
2. The frontend reconstructs the comment feed from `Posted` / `Withdrawn` / `Slashed` / `Tipped` / `Flagged` / `FlagResolved` logs — **no backend database**. Reads are cached in **IndexedDB** with **incremental sync**: a returning visitor only fetches logs for the blocks since their last visit (chunked to respect RPC `eth_getLogs` range limits), folding the delta onto the cached feed. The chain stays the source of truth; the cache is a rebuildable read model (`rebuild()` clears it). An indexer is the documented next step when volume outgrows client-side scanning — see "Persistence" below.
3. Anyone can `tip` an author (stablecoin → author, optional `tipFeeBps` to the pool) or **`flag` a comment by staking a bond** — moving it to `Challenged` and blocking the author's withdrawal.
4. A moderator calls `resolveFlag`: **upheld** → comment slashed, flagger refunded + bounty (default 50% of the stake), remainder → treasury; **rejected** → flagger forfeits the bond to treasury, comment returns to `Active`. (Direct `slash` also remains for clear-cut moderator removals.)
5. After the window with no open challenge, the author calls `withdraw` to reclaim their stake.

**Symmetric skin-in-the-game:** speaking *and* accusing both require a bond, so grief-flagging is as costly as bad commenting. The moderator adjudicates challenges (staking disciplines *who flags*, not *who judges*); forfeited bonds + slash remainders accumulate in the treasury, which can fund Tempo's gas-sponsor account.

Sybil resistance is **economic** (you can post, but throwaways lose money), not identity-based. Anonymity is via a **pseudonymous wallet** — the chain only ever sees an address. ZK proof-of-personhood is a documented future upgrade.

## Run it

### Contracts
```bash
cd contracts
export PATH="$HOME/.foundry/bin:$PATH"   # Foundry 1.7.x
forge test                                # 25/25 green
```

Deploy to Tempo testnet (fees are paid in pathUSD — fund the deployer from the faucet first):
```bash
export RPC_URL=https://rpc.moderato.tempo.xyz
export STAKE_TOKEN=0x20c0000000000000000000000000000000000000   # pathUSD (6 decimals)
export TREASURY=0xYourTreasury
export MIN_STAKE=250000          # 0.25 pathUSD (6 decimals)
export CHALLENGE_WINDOW=86400    # 1 day
export OWNER=0xYourAdmin
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY
```
The compiled ABI is auto-exported to `web/src/abi/Ante.json`.

### Frontend
```bash
cd web
cp .env.example .env.local
# set VITE_ANTE_ADDRESS to the deployed address; set VITE_DEV_PRIVATE_KEY to a
# throwaway testnet key (or wire the Turnkey passkey vars — see below)
npm install
npm run dev
```
The Tempo testnet RPC, chain id (42431), and pathUSD token address are already
baked in as defaults; you only need the deployed Ante address and a wallet.

## Wallet

A single `WalletProvider` interface (`web/src/wallet/`) with two implementations:
- **Dev fallback** (`DevWalletProvider`) — a viem local account from `VITE_DEV_PRIVATE_KEY`. **Testnet only.** This is the guaranteed end-to-end path today.
- **Turnkey passkey** (`TurnkeyWalletProvider`) — Face ID / Touch ID embedded wallet, no seed phrase. Best-effort wiring; production sign-up needs a small backend to hold the Turnkey parent-org API key (one endpoint that creates a sub-org + wallet — see `docs/tempo-facts.md`).

## Persistence

Two distinct concerns:

- **Source of truth** — on-chain, already durable. Escrow/status lives in contract storage; comment text lives in the `Posted` event (with `keccak256(content)` in storage as an integrity anchor).
- **Read/serving** — staged:
  1. **Now (serverless):** incremental client-side sync with an IndexedDB cache (above). Returning visitors fetch only the delta; cold scans paginate by `VITE_LOG_RANGE` from `VITE_DEPLOY_BLOCK`.
  2. **Later (when volume warrants):** a small indexer (e.g. Ponder, co-located with `server/`) that replays events into Postgres/SQLite and serves a paginated API; the frontend reads it and falls back to chain. This also becomes a durable, *authenticated* content store (DB holds text; the on-chain hash proves integrity) — closing the risk that an RPC prunes old logs. Don't stand this up before there's a feed worth indexing.
- **Content at scale (orthogonal):** the hash-anchor design already allows moving content to IPFS/Arweave with no contract change — emit a content URI instead of inline text; the on-chain hash still proves integrity.

## Known gaps / next steps

- **Testnet deploy is operator-gated.** The contract is unit-tested *and* verified end-to-end on a live anvil node, and the Tempo testnet faucet + RPC are confirmed reachable. The actual broadcast to Tempo testnet was intentionally left to the operator (it should use *your* wallet as owner/treasury). To go live: deploy via `contracts/script/Deploy.s.sol`, set `VITE_ANTE_ADDRESS` in `web/.env.local`, then run a real post/withdraw/slash round-trip (the `contracts/scripts/e2e-local.sh` flow, retargeted at the Tempo RPC, is your script).
- **Turnkey passkey path** — backend scaffold exists (`server/`) and typechecks; needs parent-org creds + the client-side WebAuthn registration wired into `web/src/wallet/TurnkeyWalletProvider.ts` (a `VITE_WALLET_BACKEND_URL` seam), reconciled against the live `with-tempo` example.
- **Staked flagging is implemented** (flagger bonds → moderator resolves → bounty or forfeit). The moderator is still the sole adjudicator, which is correct for a personal blog. A resolution-timeout (auto-reject if the moderator never rules, so a Challenged comment can't strand the author's stake forever) is the next refinement — see the liveness note in `SPEC.md`.
- **eth_getLogs range limits** on the public RPC are untested — may need pagination for a long feed.

## Not a git repo yet

This is intentionally plain files. Initialize git + set up a branch/PR flow when you're ready to publish.
