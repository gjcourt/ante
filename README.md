<!-- readme-type: service -->
# Ante

Stake-and-slash pay-to-comment on Tempo — accountability from a refundable stablecoin bond, not an identity

Most comment systems fight bad comments with identity (logins, real names) or moderation (delete it after the fact) — the wrong tools for an incentive problem, since speech in a comment box is free and low-effort noise is cheap to produce. Ante prices the thing that's underpriced instead: to comment, you post a small refundable stablecoin stake, which you reclaim if the comment survives a challenge window, or lose if a moderator slashes it (directly, or by upholding a flag). Readers can tip a comment's author in the same token. Flagging is staked too (the minimum flag bond defaults to the minimum comment stake), so grief-flagging isn't free either. There is no account, no real name, and no login — the contract only ever sees a pseudonymous passkey wallet address.

**Status:** live on Tempo mainnet since 2026-08-01 (v2, timelock-owned, escrowing real pathUSD) — reviewed internally ([`docs/security-review.md`](docs/security-review.md), [`docs/security-audit-2026-07-14.md`](docs/security-audit-2026-07-14.md)) but not professionally audited; the review recommends a professional audit.

## Quick start

Needs: Node 22.

```bash
git clone https://github.com/gjcourt/ante && cd ante/web
npm install
VITE_ANTE_ADDRESS=0x0ce1da48b5bde0ed1c426b225751e7c335935e89 npm run dev
```

Then open <http://localhost:5173>. This points the widget at the existing Tempo testnet deployment — connect with a passkey to try it live.

## Usage

Drop the `<ante-comments>` web component into any static page (it must be a web component, not an iframe — WebAuthn passkeys are blocked in cross-origin iframes):

```html
<ante-comments slug="my-post-slug" ante-address="0x..." token-address="0x..."
  rpc-url="https://rpc.moderato.tempo.xyz" chain-id="42431"></ante-comments>
<script src="/ante.js"></script>
```

A complete Hugo (PaperMod) example lives in [`web/examples/hugo/`](web/examples/hugo); [`web/EMBEDDING.md`](web/EMBEDDING.md) covers hosting, RPC CORS, and CSP. To put this on your own blog you deploy your own contract — walked through in [`docs/SELF-HOST.md`](docs/SELF-HOST.md).

## Configuration

The widget reads these at build time (`VITE_*` in `web/.env.local`); the embed takes the same values as HTML attributes instead (`ante-address`, `rpc-url`, …).

| Variable | Default | Meaning |
|---|---|---|
| `VITE_RPC_URL` | `https://rpc.moderato.tempo.xyz` | Tempo JSON-RPC endpoint |
| `VITE_CHAIN_ID` | `42431` | Tempo chain id (testnet Moderato; mainnet is `4217`) |
| `VITE_ANTE_ADDRESS` | zero address | Deployed `Ante` contract — the widget shows a "configure your env" banner until this is set |
| `VITE_TOKEN_ADDRESS` | `0x20c0…0000` | Stake token (pathUSD, ERC-20, 6 decimals) |
| `VITE_DEPLOY_BLOCK` | `0` | Block the feed scan starts from |
| `VITE_LOG_RANGE` | `9000` | Max block span per `eth_getLogs` call |
| `VITE_DEV_PRIVATE_KEY` | unset | Testnet-only local-key wallet, in place of the passkey flow |

Full list, with rationale for each, in [`web/.env.example`](web/.env.example).

## How it works

Posting escrows a stake and emits the comment text as an event (only its hash is stored on-chain); anyone can flag a comment by posting a bond of their own, which blocks withdrawal until a moderator resolves the challenge — an upheld flag returns the flagger's bond plus a bounty from the slashed stake (the rest goes to the treasury), a rejected flag forfeits the flagger's bond instead. A moderator can also slash an unflagged comment directly, sending the whole stake to the treasury. Sybil resistance is economic, not identity-based, and anonymity comes from a pseudonymous passkey wallet (Tempo's backendless webAuthn connector) — the contract only ever sees an address, and the frontend reconstructs the whole comment feed from chain logs, with no backend or database of its own. See [`docs/architecture.md`](docs/architecture.md) for the full component map and flows, and [`docs/security-review.md`](docs/security-review.md) for the security posture.

## Development

```bash
(cd contracts && forge build --sizes && forge test -vvv)
(cd web && npm ci && npm run build && npm run build:embed)
```

These are exactly what CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs, plus a Slither static-analysis pass on `contracts/` gated on high-severity findings. The [`Makefile`](Makefile) wraps the same operations as `make build`, `make test`, `make web-build`, `make web-embed` (`make help` lists everything, including `make e2e` for a full lifecycle run against a local anvil node). Conventions for contributors and agents: [`AGENTS.md`](AGENTS.md).

## Deployment

Ante has no server component — the contract is the deployment. The live instance runs on Tempo mainnet (chain `4217`) at `0xf18b1e9c3e2d7324d768d6728032107759366736`, owned by a `TimelockController` with separate proposer, guardian, moderator, and treasury keys — see [`docs/timelock-deploy-runbook.md`](docs/timelock-deploy-runbook.md) for the two-key deploy process. Deploying your own instance is a few `make` targets (`make wallet`, `make fund`, `make deploy-timelock`, `make verify`), covered end to end in [`docs/SELF-HOST.md`](docs/SELF-HOST.md).

## License

[MIT](LICENSE)
