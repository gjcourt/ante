# ante — stake-and-slash commenting dApp

## Overview

Ante is a stake-and-slash dApp: users stake to comment, and bad content can be
flagged and slashed. It has three parts: Solidity contracts (Foundry), a React
web app that also ships as an `<ante-comments>` web-component embed, and a
minimal backend for the Turnkey passkey embedded-wallet flow. Contracts target
the Tempo network. The `Makefile` is the primary command surface.

## Layout

- `contracts/` — Foundry project (Solidity `src/`, `test/`, deploy `script/`,
  `foundry.toml`, submodule deps in `lib/`).
- `web/` — React + Vite app; standalone build and a web-component embed
  (`vite.embed.config.ts` → `dist-embed/ante.js`). See `web/EMBEDDING.md`.
- `server/` — Turnkey sub-org + wallet creation backend (Express).
- `docs/`, `SPEC.md` — design and protocol spec.
- `Makefile` — wraps the contract + web flow.

## Develop

Foundry is auto-added to PATH by the Makefile (`$HOME/.foundry/bin`).

Contracts:

- `make build` — `forge build`. `make test` — `forge test`.
- `make e2e` — throwaway anvil + full live-node lifecycle.
- `make deploy OWNER=0x.. TREASURY=0x.. PRIVATE_KEY=0x..` — deploy to Tempo
  testnet (see `make help` for all vars). `make verify ANTE=0x..` — sanity-check.

Web (`web/`, run `npm ci`):

- `npm run dev` — Vite dev server.
- `npm run build` — standalone (`make web-build`).
- `npm run build:embed` — web-component embed bundle (`make web-embed`).

Server (`server/`, run `npm ci`):

- `npm run dev` — tsx watch. `npm run build` — `tsc`.
- `npm run typecheck` — `tsc --noEmit`. `npm start` — run compiled server.

CI (`.github/workflows/ci.yml`) runs `forge build --sizes` + `forge test`, the
web standalone and embed builds, and the server typecheck on every pull request.

## Conventions

- All changes go through a branch and pull request; never commit directly to
  `main`, and never merge with admin/bypass.
- Contract address changes: update `VITE_ANTE_ADDRESS` / `VITE_DEPLOY_BLOCK`
  from the deploy output.
