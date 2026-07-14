# Ante

[![CI](https://github.com/gjcourt/ante/actions/workflows/ci.yml/badge.svg)](https://github.com/gjcourt/ante/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Tempo mainnet](https://img.shields.io/badge/live-Tempo%20mainnet-6f42c1.svg)](./docs/security-review.md)
[![unaudited — real funds at risk](https://img.shields.io/badge/unaudited-real%20funds%20at%20risk-critical.svg)](./docs/security-review.md)

**A pseudonymous comment system where accountability comes from a refundable bond — not an identity.**

To comment, you post a small **refundable stablecoin stake**. If your comment survives a challenge window, you reclaim it (and can earn tips). If it's flagged and upheld, the stake is **slashed**. No account, no real name, no login — the system only ever sees a wallet address. **The bond is the reputation system, priced in dollars instead of karma points.**

> Most comment systems fix bad comments with *identity* (real names, logins) or *moderation* (delete it after the fact). Both are the wrong tool. Speech in a comment box is free, so people post a lot of low-effort, bad-faith noise — an incentive problem you don't solve with nametags or cleanup crews. Ante prices the thing that's underpriced, and keeps you anonymous while doing it.

> ⚠️ **Live on Tempo mainnet with real funds — and _not_ professionally audited.** `Ante.sol` has escrowed real **pathUSD** on **Tempo mainnet** (chain `4217`) at `0x547C52db2555e5d6c33f0C2715380D0cceE19676` since **2026-07-01**, with a 10% tip fee live. It has passed an in-house adversarial review ([`docs/security-review.md`](./docs/security-review.md)) but **no external audit** — the review itself recommends one before mainnet, which was not done. Open items are tracked as GitHub security advisories. **Use at your own risk.** (A separate testnet instance runs on Moderato, chain `42431`, `0x353D…1345`, for development.)

---

## How it works

1. **Post** — approve the stake token, call `post(topic, stake, content)`. The stake is escrowed; the comment text is emitted in the `Posted` event (only `keccak256(content)` is stored on-chain, as an integrity anchor). `topic` scopes the comment to a thread — the frontend uses `keccak256(post-slug)`, so every article gets its own feed.
2. **Tip** — anyone can `tip` an author (stablecoin → author; an optional `tipFeeBps` can route a share to a pool).
3. **Challenge** — flagging is *also staked*: `flag(id, bond, reason)` bonds funds and moves the comment to `Challenged`, blocking the author's withdrawal. Accusing costs skin, just like speaking.
4. **Resolve** — a moderator calls `resolveFlag(id, uphold, reason)`:
   - **upheld** → comment slashed; the flagger is **refunded their bond + a bounty** (default 50% of the stake); the remainder goes to the treasury.
   - **rejected** → the flagger **forfeits the bond** to the treasury; the comment returns to `Active`.
5. **Withdraw** — after the window with no open challenge, the author calls `withdraw` and reclaims the stake.

**Symmetric skin-in-the-game.** Speaking *and* accusing both require a bond, so grief-flagging is as costly as bad commenting. Staking disciplines *who flags*; a moderator still adjudicates *who's right* (correct for a personal blog — you don't decentralize the moderation of your own comment section). Forfeited bonds + slash remainders accrue to the treasury, which can fund Tempo's gas-sponsor account.

Sybil resistance is **economic** (you can post, but throwaways lose money), not identity-based. Anonymity is via a **pseudonymous passkey wallet** — Tempo's official wagmi webAuthn connector, backendless (a client-side WebAuthn ceremony, no API keys, no signup), with no seed phrase and no account. ZK proof-of-personhood is a documented future upgrade.

### Why a *bond*, not a charge

A toll (pay to comment, keep the money) prices *speech*: it taxes your best contributors, lets anyone with money say anything, and leaves the bad comment up. A bond prices *bad behavior*: the good-faith commenter pays nothing in the end, and the refund is exactly what makes removal legitimate. The variable stake even doubles as a confidence signal — bonding above the minimum credibly says "I'll risk more on this not being removed."

## Architecture

| Dir | What | Status |
|---|---|---|
| [`contracts/`](./contracts) | Foundry: `Ante.sol`, mocks, tests, deploy + local-e2e scripts | **52/52 tests pass**; full lifecycle verified on a live node, deployed to Tempo testnet |
| [`web/`](./web) | Vite + React + TS comment widget **and** a `<ante-comments>` web component (shadow DOM) | builds clean; incremental IndexedDB feed sync; backendless passkey wallet (Tempo wagmi webAuthn) + dev-key fallback |
| [`docs/`](./docs) | `tempo-facts.md` (verified chain/wallet config), `security-review.md` | — |

Key design docs: [**SPEC.md**](./SPEC.md) (full mechanism), [**web/EMBEDDING.md**](./web/EMBEDDING.md) (embedding on a site), [**docs/security-review.md**](./docs/security-review.md).

## Quickstart

Everything is wrapped in the [`Makefile`](./Makefile) (`make help` lists targets). Foundry is added to `PATH` automatically.

```bash
make test        # forge test — 52/52
make e2e         # spin up anvil + run the full lifecycle on a live node
make web-build   # build the standalone web app
make web-embed   # build the <ante-comments> embed bundle (dist-embed/ante.js)
make cors-check  # confirm the RPC allows browser calls (for embedding)
```

### Run the widget against the live contract

```bash
cd web
cp .env.example .env.local
# set VITE_ANTE_ADDRESS (the deployed address) and VITE_DEPLOY_BLOCK.
# For a wallet: use a passkey (default, no env) or set a throwaway testnet
# VITE_DEV_PRIVATE_KEY for the dev-key fallback.
npm install && npm run dev          # → http://localhost:5173
```
The Tempo testnet RPC, chain id (`42431`), and pathUSD token are baked in as defaults — you only need the Ante address. The passkey wallet is backendless and needs no configuration; the dev key is an optional testnet fallback.

## Deploy your own

Tempo charges gas in stablecoins, so the deployer must hold pathUSD (free from the faucet). One command each:

```bash
make wallet                       # generate a deployer keypair
make fund ADDR=0xYourDeployer     # faucet pathUSD
make deploy OWNER=0x.. TREASURY=0x.. PRIVATE_KEY=0x.. CHALLENGE_WINDOW=120
make verify ANTE=0xDeployed       # sanity-check it's live
```
`OWNER` becomes the admin and first moderator; `TREASURY` receives slashed stakes and forfeited bonds. The compiled ABI is auto-exported to `web/src/abi/Ante.json`.

## Embed it on a site

Ante ships as a **web component**, so it drops into any static site with one script tag and no framework coupling (and it must be a web component, not an iframe — WebAuthn passkeys are blocked in cross-origin iframes):

```html
<ante-comments slug="my-post-slug" ante-address="0x..." token-address="0x..."
  rpc-url="https://rpc.moderato.tempo.xyz" chain-id="42431"></ante-comments>
<script src="/ante.js"></script>
```

A complete **Hugo (PaperMod)** example lives in [`web/examples/hugo/`](./web/examples/hugo), and [`web/EMBEDDING.md`](./web/EMBEDDING.md) covers hosting, RPC CORS, and CSP.

## Persistence

The chain is the source of truth; everything else is a rebuildable read model.

- **On-chain** — escrow/status in contract storage; comment text in the `Posted` event (`keccak256(content)` anchors integrity).
- **Now (serverless)** — the frontend folds the comment feed from logs and caches it in **IndexedDB** with **incremental sync**: a returning visitor only fetches the blocks since their last visit (chunked to respect RPC `eth_getLogs` limits).
- **Later** — a small indexer (e.g. Ponder) when volume outgrows client-side scanning; it also becomes a durable, *authenticated* content store. Content can move to IPFS/Arweave with no contract change (emit a URI; the on-chain hash still proves integrity).

## Security

The contract was hardened after an adversarial review — see [`docs/security-review.md`](./docs/security-review.md). Highlights: fee-on-transfer-safe escrow (credits the *actually received* amount via balance-delta), aggregate escrow accounting, min-stake bounds, and disabled `renounceOwnership`. `SafeERC20` + `ReentrancyGuard` throughout; checks-effects-interactions on every fund move. **52/52 tests** cover the invariants, both resolve paths, fee-on-transfer accounting, and access control. **Not professionally audited**, and **live on Tempo mainnet holding real pathUSD** — the review's own verdict recommends an audit before mainnet, which has not been done. Known open items are tracked as GitHub security advisories (notably an unbounded `setChallengeWindow` that can retroactively extend the stake lock, and a single-key owner/treasury/moderator). Real funds are at risk.

## Roadmap

- **Resolution timeout** — auto-reject if a moderator never rules, so a `Challenged` comment can't strand the author's stake (liveness note in `SPEC.md`).
- **Indexer** — when a feed outgrows client-side log scanning.
- **Variable-stake confidence signal** — surfaced quietly today; a richer treatment is a follow-up.
- **ZK proof-of-personhood** — optional sybil-resistance upgrade that keeps anonymity.

## License

[MIT](./LICENSE) © George Courtsunis
