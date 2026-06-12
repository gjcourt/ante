# ante-server

Minimal backend for Ante's **Turnkey passkey** embedded-wallet flow. Its only job is to turn a browser passkey registration into a Turnkey **sub-organization + wallet**, keeping the parent-org API key server-side (it must never reach the browser).

This server is **optional**. The frontend's dev-key wallet path works without it; you only need this once you want real Face ID / Touch ID wallets with no seed phrase. The server never touches a stake or a tip — all on-chain actions happen client-side against Tempo.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/healthz` | — | `{ ok: true }` |
| POST | `/api/wallet` | `{ userName, challenge, attestation }` | `{ subOrganizationId, walletId, address }` |

The browser performs WebAuthn registration and posts the resulting `challenge` + `attestation`; the server creates the sub-org (root user = that passkey) and an EVM wallet. The returned `address` is usable directly on Tempo (EVM-compatible).

## Run

```bash
cp .env.example .env     # fill in Turnkey PARENT-org creds
npm install
npm run dev              # tsx watch on :8787
```

Point the frontend at it with `VITE_WALLET_BACKEND_URL=http://localhost:8787`.

## Status / TODO(facts)

`src/turnkey.ts` calls `createSubOrganization` through a narrowly-typed boundary because the exact request/response shape differs across `@turnkey/sdk-server` majors (the Tempo doc page self-flags as incomplete). It **typechecks and boots** as-is; before production, reconcile the exact field names against the official example:
<https://github.com/tkhq/sdk/tree/main/examples/with-tempo>

Verify a real round-trip (register passkey → create wallet → fund from faucet → post a comment) once Turnkey parent-org creds are in place.
