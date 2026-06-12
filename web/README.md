# Ante — web widget

Vite + React + TypeScript front end for **Ante**, a pseudonymous pay-to-comment
widget with stake-and-slash on the Tempo chain. To comment, a reader posts a
small refundable stablecoin **stake**; good comments get it back (and can earn
tips), challenged-and-upheld comments get it **slashed**. Challenging is also
**staked**: a flagger bonds funds to open a challenge, then a moderator resolves
it — upheld refunds the bond plus a bounty, rejected forfeits it. No account, no
seed phrase — a passkey-backed embedded wallet (Turnkey), with a dev key
fallback for testnet.

All on-chain reads/writes go through **viem**. Comments are reconstructed
entirely from contract events (`Posted` / `Withdrawn` / `Slashed` / `Tipped` /
`Flagged` / `FlagResolved`) — there is no backend database.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev                  # http://localhost:5173
```

Build / preview:

```bash
npm run build        # tsc -b + vite build → dist/ (standalone app)
npm run build:embed  # tsc -b + vite build → dist-embed/ante.js (web component)
npm run preview      # serve the production build
```

### Embedding in a blog (Hugo)

`npm run build:embed` produces `dist-embed/ante.js`: one self-contained,
self-registering bundle that defines a `<ante-comments>` **web component**
(React bundled in, styles injected into a shadow root). Drop it into a Hugo
site (or any static page) for per-post comment threads. See
[`EMBEDDING.md`](./EMBEDDING.md) and [`examples/hugo/`](./examples/hugo/).

Per-post threading: the element takes a `slug` (or raw `topic`) attribute,
hashes the slug to the on-chain `topic` (`keccak256(slug)`), passes it to
`post()`, and filters the `Posted` `eth_getLogs` by that indexed topic — so each
article gets its own isolated thread.

The app **builds and runs without any env configured** — it renders the demo
page and the widget, and shows a "configure your env" banner where live chain
data would load. Fill in the env vars to connect to Tempo testnet.

## Environment variables

See [`.env.example`](./.env.example) for the full list. Summary:

| Var | Required | Purpose |
|---|---|---|
| `VITE_RPC_URL` | yes (live) | Tempo testnet JSON-RPC endpoint |
| `VITE_CHAIN_ID` | yes (live) | Tempo testnet chain id (decimal) |
| `VITE_ANTE_ADDRESS` | yes (live) | Deployed `Ante` contract address |
| `VITE_TOKEN_ADDRESS` | yes (live) | Stake-token (TIP-20 stablecoin) address |
| `VITE_IS_MODERATOR` | no | `true` forces the moderator resolve panel on without reading the on-chain `moderators` mapping (dev/demo only) |
| `VITE_DEV_PRIVATE_KEY` | dev fallback | Throwaway **testnet** key (`0x`+64 hex) for the dev wallet |
| `VITE_TURNKEY_ORGANIZATION_ID` | Turnkey path | Turnkey parent org id |
| `VITE_TURNKEY_API_BASE_URL` | Turnkey path | Turnkey API base URL |
| `VITE_TURNKEY_RP_ID` | Turnkey path | WebAuthn relying-party id (your domain) |
| `VITE_TURNKEY_SIGN_WITH` | Turnkey path | Provisioned Turnkey wallet address to sign with |

> Values marked `TODO(facts)` in the source are placeholders awaiting verified
> Tempo facts (`docs/tempo-facts.md`). Supply them via env before any real use —
> the code never invents an RPC URL, chain id, or token address.

## Wallet model

A single [`WalletProvider`](./src/wallet/WalletProvider.ts) interface
(`connect()`, `getAddress()`, `signAndSend(tx)`, `getWalletClient()`) with two
implementations:

1. **Turnkey passkey** ([`TurnkeyWalletProvider`](./src/wallet/TurnkeyWalletProvider.ts))
   — the real embedded-wallet path (Face ID / Touch ID, no extension, no seed
   phrase). Selected when all `VITE_TURNKEY_*` vars are set. The exact Turnkey
   SDK call shapes are marked `TODO(facts)` pending verified setup notes.
2. **Dev key** ([`DevWalletProvider`](./src/wallet/DevWalletProvider.ts)) — a
   viem local account from `VITE_DEV_PRIVATE_KEY`. **Testnet only.** This is the
   path that makes the app run end-to-end today.

`selectWalletProvider()` prefers Turnkey, falls back to the dev key.

## Architecture

| File | Role |
|---|---|
| `src/config/chain.ts` | `AnteConfig` type, env-derived `defaultAnteConfig`, `makeChain()`, viem `Chain` (env- and runtime-overridable) |
| `src/config/AnteProvider.tsx` | React context supplying the runtime `AnteConfig`; `useAnteConfig()` falls back to env defaults |
| `src/wallet/*` | `WalletProvider` seam + Turnkey and dev implementations (config-driven) |
| `src/hooks/useAnte.ts` | reads comments from logs (Posted filtered by `topic`); `post` / `withdraw` / `tip` / staked `flag` / moderator `resolveFlag` + ERC-20 approve handling; accepts an optional config override (e.g. `topic`) |
| `src/components/AnteComments.tsx` | the widget (list, composer, withdraw, tip, staked challenge, moderator resolve panel) |
| `src/embed/ante-element.tsx` | the `<ante-comments>` web component (shadow root + injected CSS + `AnteProvider`); built by `npm run build:embed` |
| `src/abi/Ante.json` | compiled Foundry ABI matching `contracts/src/Ante.sol` |
| `src/abi/erc20.ts` | minimal ERC-20 ABI (decimals/symbol/allowance/approve) |
| `src/App.tsx` | demo page mounting `<AnteComments />` (global feed) |

### Approve handling

`post` and `tip` move the stake token via the contract's `transferFrom`, so the
hook ensures an ERC-20 allowance first. It reads the current `allowance` and
**skips `approve` when it already covers the amount**; otherwise it approves
(max) once. Token `decimals()` is fetched live — never hardcoded — and amounts
are formatted/parsed with viem `formatUnits` / `parseUnits`.
