# Passkey refactor — Turnkey → Tempo wagmi webAuthn connector (round 4)

Branch: `feat/passkey-webauthn` (worktree `/Users/george/src/ante/.worktrees/passkey-refactor`).

> **Round-4 rewrite after critique round 3.** Round 3 over-corrected. It declared
> the round-2 `calls:[...]` batch model "hallucinated" and froze the send path on
> a plain viem `walletClient.sendTransaction({to,data,value})`. Per the official
> docs (`wagmi.sh/tempo` getting-started) that is itself wrong: Tempo's documented
> send primitive is `useSendTransactionSync` / `sendTransactionSync.mutate({ calls:
> [{ to, data }], feePayer, nonceKey })` — a Tempo-specific batched, fee-payer,
> nonce-keyed transaction type. The `calls` array is the DOCUMENTED API, not a
> hallucination. Whether a bare `sendTransaction({to,data})` even works through the
> webAuthn connector (which is fee-payer/nonce aware) is **unproven and doubtful**.
>
> Round 4 therefore stops hard-coding a send MODEL. The `sendTx` seam keeps a
> stable `{to,data,value} → hash` signature (so `useAnte`'s six writes never
> change), but its passkey implementation is deliberately left to the §9 spike to
> back with EITHER (a) `walletClient.sendTransaction` if the spike proves it works,
> OR (b) a `useSendTransactionSync` mutation wrapping `{to,data}` into a
> single-element `calls` array. §9 item 1 is the gate that decides.
>
> Round 4 also fixes four hard-wrong identifiers round 3 froze (`tempoModerato`,
> `webAuthn({testnet})`, `tempoWallet` from `wagmi/connectors`, "no `Hooks`
> namespace"), corrects the cross-Config storage semantics, and trims the process
> ceremony (no CI on-chain e2e, no mandated jsdom test harness) down to what
> actually gates correctness. See §0.0 pinned facts and §0.1 the seam.

## 0. Goal

Replace the half-built Turnkey embedded-wallet path with Tempo's **official wagmi
webAuthn passkey connector**. The connector is backendless (a client-side WebAuthn
ceremony scoped to the current origin's registrable domain, no API keys, no
signup, no `authUrl` by default), so the entire `server/` backend and all
`@turnkey/*` usage are deleted. The dev private-key path (`DevWalletProvider`)
stays as a local-dev-only fallback. The widget must keep working as **both** the
standalone Vite app (`npm run build`) and the shadow-DOM web component embed
(`npm run build:embed`), and must stay runtime-configurable via HTML attributes
(chainId / rpc / addresses read at runtime), so testnet (Moderato, 42431) and
mainnet (Tempo, 4217) both work.

## 0.0 Pinned facts

Two tiers. **Verified** (from the repo / on-chain deploy). **To-verify in the §9
spike** (from Tempo/wagmi docs, NOT yet confirmed against installed code — nothing
is installed yet; `node_modules` has no wagmi / viem 2.43 / `accounts`). Do not
freeze the §7 contracts until the spike confirms these.

**Verified:**

- MAINNET `tempo`: chainId `4217` (0x1089), RPC `https://rpc.tempo.xyz`,
  explorer `https://explore.tempo.xyz`. Deployed Ante
  `0x547C52db2555e5d6c33f0C2715380D0cceE19676`.
- TESTNET Moderato: chainId `42431` (0xa5bf), RPC
  `https://rpc.moderato.tempo.xyz`, explorer `https://explore.testnet.tempo.xyz`.
- Stake token pathUSD `0x20c0000000000000000000000000000000000000`, 6 decimals.
- Tempo has no volatile native gas token; gas is paid in a stablecoin. The viem
  chain `nativeCurrency` is label-only.
- Repo pins `viem@^2.21.0` and has NO wagmi / react-query / `accounts` installed.
  `viem 2.21` is INCOMPATIBLE with the Tempo SDK (`accounts` needs `viem
  >=2.43.3`). The viem bump is **mandatory** (§5).
- `chain.ts` today ALSO exports (beyond the §7 core): `tempoTestnet` (line 175),
  `isChainConfigured` (line 196), and the backward-compat block `CHAIN_ID` /
  `RPC_URL` / `ANTE_ADDRESS` / `TOKEN_ADDRESS` (lines 138–141). Grep confirms the
  ONLY external importer of `chain.ts` is `ante-element.tsx`, which imports only
  `type AnteConfig` (line 6). Nothing imports `tempoTestnet`, `isChainConfigured`,
  or the CHAIN_ID block. They are **dead → delete them** (§3). A comment at line 47
  also names `selectWalletProvider` — update it.
- `useAnte.ts` line 135 types `walletKind: WalletProvider["kind"] | null` — a
  direct type dependency on `WalletProvider.ts`, which this refactor DELETES. It
  MUST be replaced with `WalletKind | null` in the same step the delete lands.
- `AnteComments.tsx` gets `walletKind` by destructuring `useAnte()` (line 22); the
  `WalletBadge` prop is a LOCAL inline union `kind: "dev" | "turnkey" | null`
  (line 112) and the label ternary is `kind === "turnkey" ? "Passkey" : "Dev key"`
  (line 119). `AnteComments` imports NOTHING from `../wallet` today.

**To-verify in the §9 spike (docs claims; freeze §7 only after confirming):**

- **The send primitive.** Per `wagmi.sh/tempo` getting-started, Tempo's documented
  send API is `useSendTransactionSync` (from `wagmi`), invoked as
  `sendTransactionSync.mutate({ calls: [{ to, data }], feePayer, nonceKey })` — a
  Tempo-specific batched, fee-payer, nonce-keyed transaction type. The `calls`
  array is the DOCUMENTED shape. Whether the webAuthn connector's viem
  `WalletClient` ALSO accepts a raw `walletClient.sendTransaction({to,data,value})`
  (with no feePayer/nonceKey) is UNPROVEN — the docs never show it. **§9 item 1
  decides which backs the passkey `sendTx`.** Do not assert either as fact until
  then, and do NOT call the `calls` model "hallucinated" — it is the primary API.
- `webAuthn` connector imported from `wagmi/tempo`. `tempoWallet` ALSO from
  `wagmi/tempo` (same subpath — both provided by the `accounts` wrapper), NOT from
  `wagmi/connectors` (that is core wagmi's injected/walletConnect/coinbase
  connectors and does not export Tempo connectors). We only use `webAuthn` this
  round. Confirm subpath resolution.
- `webAuthn()` options per docs: `authUrl`, `ceremony`, `icon`, `name`, `rdns`,
  `authorizeAccessKey`. **There is NO `testnet` option.** Network is selected by
  the CHAIN object in `chains: [...]` (see next bullet), never by a connector flag.
- Chain objects: `import { tempo, tempoDevnet, tempoLocalnet, tempoTestnet } from
  "wagmi/chains"`. There is NO `tempoModerato` export — the testnet chain is
  `tempoTestnet`. **§9 item 3 must additionally assert `tempoTestnet.id === 42431`
  (Moderato).** If `tempoTestnet.id !== 42431`, fall back to `defineChain` for
  Moderato and verify the connector accepts a hand-defined testnet chain. The
  wagmi chain object's `.id` MUST equal the runtime `config.chainId` or the
  `transports: { [config.chainId]: ... }` keying will mismatch the chain object.
- Connection/account state for Ante is read via the **standard `wagmi` hooks**
  (`useAccount`, `useConnect`, `useDisconnect`, `useConnectors`, `useConfig`,
  `useWalletClient`, `useReconnect`, and `useSendTransactionSync` if used), all
  imported from `"wagmi"`. A `Hooks` namespace AND an `Actions` namespace DO exist
  in `wagmi/tempo` (Tempo-specific token/dex/amm/wallet/fee/nonce protocol
  helpers) — round 3's flat "there is NO `Hooks` namespace" was wrong. We simply
  **do not use `Hooks.*` for connection state and do not use `Actions.*` for
  Ante's arbitrary writes** (there is no named Action for `post`/`withdraw`/
  `tip`/`flag`/`resolveFlag`/`approve`). Confirm the standard-hook shapes; note
  (do not deny) the Tempo namespaces exist.
- `viem/tempo` subpath: round-3 asserted it provides `tempoActions()`/event
  helpers. **UNVERIFIED — not corroborated in the surfaced docs. We do not use it;
  do not rely on it.** No claim is made about its surface.

## 0.1 The signing seam (core architectural decision)

**Both paths satisfy ONE seam that `useAnte`'s write bodies touch. The seam's
signature is stable; its passkey backing is spike-decided.**

```ts
// The one seam useAnte's six write bodies touch (signature FROZEN):
type Signer = {
  /** the active address, or undefined if not connected. NOT an accessor that
      connects as a side effect — connect() is called explicitly at the call site. */
  address: `0x${string}` | undefined;
  /** send raw calldata; resolves to the tx hash. Implementation is dev OR passkey. */
  sendTx: (tx: { to: `0x${string}`; data: `0x${string}`; value?: bigint }) => Promise<`0x${string}`>;
};
```

- **Dev impl:** `DevWalletProvider` holds a viem `WalletClient`;
  `sendTx = (tx) => walletClient.sendTransaction({ account, chain, ...tx })` (its
  existing `signAndSend`, unchanged). This is a standard EOA WalletClient.
- **Passkey impl (spike-decided — §9 item 1):** back `sendTx` with EITHER
  - (a) `walletClient.sendTransaction({ to, data, value })` from the connector's
    viem WalletClient (via `useWalletClient()` / `getConnectorClient(config)`), IF
    the spike proves a raw send works through the fee-payer/nonce-aware connector;
    OR
  - (b) a wagmi `useSendTransactionSync()` mutation:
    `sendTransactionSync.mutateAsync({ calls: [{ to, data }] /*, feePayer,
    nonceKey per docs */ })`, wrapping the single `{to,data}` into the documented
    `calls` array and returning the resulting hash.

  Either way the `usePasskeyWallet.sendTx({to,data,value})` signature is identical,
  so `useAnte`'s writes do not change. The WebAuthn ceremony fires inside whichever
  send call the connector uses to sign.
- `useAnte` resolves the active signer as a **plain value at render top-level**:
  dev key present → dev signer; else → passkey signer. Each write keeps its
  existing `encodeFunctionData` + `ensureAllowance` + `waitForTransactionReceipt` +
  `loadComments`; the ONLY change is `w.signAndSend({ to, data })` → `await
  signer.sendTx({ to, data })`, preceded by an explicit `if (!from) await connect()`.

> Why the seam is stable but the impl is not frozen: the round-3 "plain
> sendTransaction, and `calls` was hallucinated" thesis is contradicted by the
> official docs, which document `useSendTransactionSync({calls})` as the primary
> send API. Because the dev CI/local path is a standard EOA WalletClient (not the
> connector), it would NOT surface a connector that rejects raw `{to,data}`. So the
> plan refuses to freeze a send model and lets §9 item 1 empirically choose (a) or
> (b). We keep a thin `usePasskeyWallet()` adapter to localize the `wagmi`/
> `wagmi/tempo` imports and hand `useAnte` one object — it is a function/value
> adapter, not the retired OO `WalletProvider` class, and not `Actions`.

### Bundle note (api-correctness minor)

`useWalletClient()` returns a "fat" viem WalletClient with ALL wallet actions
attached, which the embed's inlined bundle (§3) would pull in whole. If §9 item 1
lands on path (a), prefer `getConnectorClient(config)` + viem's standalone
`sendTransaction` action (tree-shakable) over `useWalletClient()` to avoid
attaching every wallet action. If §9 lands on path (b) (`useSendTransactionSync`),
this is moot — no fat WalletClient is pulled in. Decide in §9 item 1.

## 0.2 Mandatory pre-flight spike (before writing any wallet code)

`node_modules` has NONE of the target packages, and prior rounds baked
hallucinated API shapes into "frozen" contracts. So the spike runs FIRST:
`npm install`, verify the load-bearing facts below, record answers in
`docs/tempo-facts.md`, and only THEN freeze §7 and start the wallet layer.

**Most facts are resolved instantly by `npm install` + `tsc` against the installed
types** (subpath resolution, hook existence, `webAuthn()` option names, chain
export name and `.id`, the presence/absence of `Hooks`/`Actions`). Those are
"confirm while implementing," not a written falsifiable matrix.

**Only two are true hard gates — escalate, don't ship, if they fail:**

1. **Send path (the crux).** After install + a real Moderato passkey ceremony,
   empirically determine whether the webAuthn connector's viem WalletClient accepts
   a raw `sendTransaction({ to, data, value })` (arbitrary calldata, e.g. an ERC20
   `approve`, no feePayer/nonceKey) — path (a) — OR whether writes MUST go through
   `sendTransactionSync.mutate({ calls: [{to,data}], ... })` — path (b). Record
   which works and back `usePasskeyWallet.sendTx` accordingly. If NEITHER carries
   an arbitrary `{to,data}` write, STOP and escalate. Also decide here whether to
   use `getConnectorClient` + standalone `sendTransaction` (bundle note above).
2. **Deterministic identity — the thesis.** "Come back and your stake is yours"
   needs the SAME address to return. On **Moderato** (free; no real stake), record:
   - (a) same browser, reload → **expect SAME address**.
   - (b) same browser, **cleared `localStorage`/wagmi storage**, then login →
     **expect SAME address** (proves the address derives from the credential, not
     wagmi cache). **If (b) yields a different/absent address, the thesis is
     BROKEN — BLOCKER, escalate.**
   - (c) second browser profile / synced platform authenticator → record SAME or
     DIFFERENT (recoverability boundary). One-line manual note; not a required cell.
   - (d) a NEW device with no synced authenticator → record expected outcome
     (almost certainly different/absent). One-line manual note; used to word the
     UI/docs caveat.
   Determinism is a property of the WebAuthn credential + connector derivation,
   **not the chain**, so the Moderato result is sufficient proof; mainnet is a
   post-launch smoke (§9 Manual), NOT a merge gate — do not burn real pathUSD to
   satisfy a checkbox.

**Backendless / pseudonymous hard gates (thesis-lens):**

3. **rpId scope.** Record the connector's default WebAuthn `rpId`. If the default
   rpId is a **Tempo-hosted relay** (rather than the top-level origin's registrable
   domain), the "backendless, no account, pseudonymous" thesis is FALSE — **STOP
   and escalate**, do not ship a product marketed as backendless that binds
   identity to a hosted relay. Only a benign wording delta (registrable-domain vs
   hostname) is a docs fix; the PRESENCE of a relay is an escalation. Also record
   whether `rpId` is overridable without an `authUrl`.
4. **Network / phone-home check.** During the Moderato ceremony, capture the
   network panel (or run offline-after-load). If connect OR send hits ANY
   `tempo.xyz` auth/attestation host beyond the RPC, the backendless/pseudonymous
   claim is FALSE — **STOP and escalate** (a third party seeing every connect is
   the exact account/tracking vector the thesis rejects). No requests beyond RPC =
   record as the backendless evidence.

**Shadow-DOM / multi-root gates (shadow-dom-lens) — run in the EMBED shape, not a
plain harness.** Build the embed (`npm run build:embed`), drop `<ante-comments>`
onto a minimal HTTPS host page served from a DIFFERENT subdomain than the
standalone app, and run the following FROM the shadow-DOM button:

5. **Embed-shaped rpId + realm boundary + activation** (merges old items 6+9).
   Connect + post + second-session re-login from inside the shadow root. Record:
   the observed rpId; that the address matches the standalone-origin address IFF
   the rpId is the shared registrable domain (this validates/breaks the §1 realm
   boundary and the §3 caveat copy); and that transient user activation survives
   the click crossing the connector's internal awaits (the OS dialog fires). Also
   record the **standalone-origin address AND the embed-host-origin address for the
   SAME authenticator and assert they DIFFER** when the origins are different
   registrable domains — the falsifiable proof of the realm boundary (§1).
6. **Silent rehydrate vs eager ceremony, under StrictMode, with N≥2 roots.** With
   `reconnect()` gated on status (below), confirm: (1) a previously-connected
   passkey's ADDRESS rehydrates from storage at MOUNT, AND (2) **no OS credential
   dialog fires** (`navigator.credentials.get()`) without a click. Run this (a)
   under `StrictMode` (the embed renders `<StrictMode>`, so the mount effect runs
   twice), and (b) with **two `AnteWeb3Provider` roots in one document** (two
   `<ante-comments>` on a page). Assert: no double `credentials.get()`, no Config
   stuck in `reconnecting`. Additionally: connect in root A while root B is already
   mounted, and **record whether root B's `useAccount().status` ever flips without
   its own reconnect/remount** (it will not — see §1). The gate here is
   correctness (no double dialog / no stuck state), not the cross-root propagation
   result, which only informs UX.
7. **Runtime chain-switch teardown.** After connecting in the embed, flip the
   `chain-id` attribute (testnet↔mainnet). Confirm the old Config's connection is
   cleaned up with no orphaned listeners/timers and the new Config builds cleanly.
   This exercises the §2 Config-memo teardown path (the jsdom memo assertion, if
   written, proves identity churn only, not connector teardown).
8. **Remount after DOM move.** Confirm that a React-root remount (host page moves
   the `<ante-comments>` node → `disconnectedCallback` → unmount → reconnect)
   re-hydrates the address WITHOUT a new dialog (consistent with item 6). Any
   in-flight ceremony surviving a remount is OUT OF SCOPE — a remount resets
   in-progress connection state; only the persisted address re-hydrates.

**Resolved-while-implementing (tsc/build answers them; one-line note in
`docs/tempo-facts.md`, no matrix):** subpath resolution (`wagmi/tempo`,
`wagmi/chains`); the exact testnet chain export name + `tempoTestnet.id === 42431`;
standard-hook shapes and that `Hooks`/`Actions` namespaces exist but are unused;
`webAuthn()` option names (no `testnet`); viem 2.21→2.43 breaking-change scan of
existing call sites (`encodeFunctionData`, `waitForTransactionReceipt`,
`defineChain`, `sendTransaction`, `readContract`, `getLogs`, `watchEvent`).

## 1. Before / after architecture

### Signing today (Turnkey seam)

- `useAnte` lazily calls `selectWalletProvider(config)` (in `wallet/index.ts`) →
  `TurnkeyWalletProvider.fromConfig(config) ?? DevWalletProvider.fromConfig(config)
  ?? null`.
- The returned object implements the hand-rolled `WalletProvider` interface
  (`kind`, `connect()`, `getAddress()`, `signAndSend()`, `getWalletClient()`).
- Every write encodes calldata and calls `w.signAndSend({ to, data })`.
- `TurnkeyWalletProvider` dynamically imports `@turnkey/*` (all stubbed TODO);
  `server/` is a standalone Express app; `web/` never imports it.

### Signing after (wagmi webAuthn passkey — single stable seam)

- An `AnteWeb3Provider` wraps children with `<WagmiProvider><QueryClientProvider>`,
  building a wagmi `Config` at runtime from `useAnteConfig()`, using the Tempo
  chain object selected by network (`tempo` vs `tempoTestnet`), transport
  `http(config.rpcUrl)`, and the single `webAuthn()` connector.
- The OO `WalletProvider` seam is **deleted**. `useAnte`:
  - reads address/status from the standard `useAccount()` (via `usePasskeyWallet`);
  - resolves ONE signer per render (dev = `DevWalletProvider`; passkey =
    `usePasskeyWallet`) exposing `{ address, sendTx }`;
  - keeps every write body identical except `w.signAndSend(...)` → `await
    signer.sendTx(...)`, with an explicit `if (!from) await connect()` preamble.
- The **`DevWalletProvider` is kept** as a non-wagmi fallback, selected only when
  `config.devPrivateKey` is set.
- Runtime HTML-attribute config is preserved: the wagmi `Config` is built inside
  React from `AnteConfig` (never a module-level singleton). `chainId`/`rpcUrl`
  changes rebuild the Config; `anteAddress`/`tokenAddress`/`topic` changes do NOT.
- `server/` and both `@turnkey/*` deps are deleted. No server replacement.

### Identity scope: widgets, and standalone vs embed (shadow-DOM reality)

`ante-element.tsx` creates a SEPARATE React root + `AnteProvider` →
`AnteWeb3Provider` → `WagmiProvider` per `<ante-comments>` element. So N widgets on
a page = N wagmi Configs, each with its own in-memory connection state. We do NOT
build a shared hoist point.

**Contract all workstreams code to:**

- The **address/passkey is shared** across widgets on the SAME origin (WebAuthn is
  domain-scoped), but only via **storage read at MOUNT/RECONNECT time**. wagmi
  Configs do NOT observe each other at runtime: the browser `storage` event does
  NOT fire in the document that performed the write, and wagmi's default storage is
  a passive key-value cache, not a live cross-instance bus. So:
  - A live connect in widget A does **NOT** propagate to an already-mounted widget
    B in the same tick. B only picks up the shared session on its OWN
    mount/reconnect read. Do not ship copy/UX implying widget B flips to
    "connected" when A connects — §9 item 6 records the observed behavior; UX is
    decided from it (accept per-widget connect, or add an explicit storage-event
    listener / shared reconnect trigger only if the observed behavior warrants it).
  - **Live connection state is per-Config.**
  - **Silent reconnect at mount** rehydrates a prior session's ADDRESS from the
    shared same-origin storage WITHOUT a ceremony (§9 item 6). We use wagmi's
    **default storage (no custom key)** so all same-origin Configs share one
    namespace. If §9 shows the connector cannot rehydrate the address without a
    ceremony, accept **per-widget / per-load click-to-connect** and drop the
    "seamless return" framing. Either outcome is correctness-safe.

- **Standalone origin ≠ embed origin ≠ separate identity realms (thesis major).**
  The standalone app runs on its OWN origin; the embed runs on the HOST blog's
  registrable domain (e.g. `burntbytes.com`). WebAuthn is domain-scoped, so a user
  who stakes via the blog embed gets a **DIFFERENT passkey/address** than the same
  user on the standalone app — their stake is **invisible and unrecoverable across
  the two shipping surfaces of the same product**. This is a first-class
  consequence, not a footnote:
  - §9 item 5 MUST record the standalone address AND the embed-host address for the
    SAME authenticator and assert they DIFFER (when the origins are different
    registrable domains).
  - The §3 UI caveat MUST name the boundary concretely ("funds staked here are
    separate from any other Ante site, including the standalone app").

- **Per-root QueryClient → no cross-widget read de-dup (shadow-dom minor).** Each
  root gets its own `QueryClient`, so N widgets independently fetch/poll the same
  on-chain reads (comments feed, allowance, moderator status) — N× RPC load and N×
  polling timers. Accepted: the expected count is **1 widget per blog post**, so
  this is fine in practice. If multiple widgets per page becomes a real case, it is
  a (second) reason to reconsider a per-origin shared singleton (Config +
  QueryClient) — tied to the same decision point as any reconnect race found in §9
  item 6. Not built now.

- No workstream builds a shared hoist point. Path-disjoint files here do NOT imply
  compile-independence for the `AnteProvider ↔ AnteWeb3Provider` pair (§8).

## 2. New files

### `web/src/wallet/AnteWeb3Provider.tsx` (NEW)

Runtime-configured wagmi provider, built inside React from `useAnteConfig()`.

```tsx
import { WagmiProvider, createConfig, http, useReconnect, type Config } from "wagmi";
import { webAuthn } from "wagmi/tempo";
import { tempo, tempoTestnet } from "wagmi/chains"; // testnet export = tempoTestnet (§9 item 3)
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isMainnet } from "../config/chain";
import { useAnteConfig } from "../config/AnteProvider";
// makeWagmiConfig is module-private (NOT on the barrel).
```

Behaviour:

- **Chain object from `wagmi/chains`:** `chains: [isMainnet(config) ? tempo :
  tempoTestnet]`. §9 item 3 asserts `tempoTestnet.id === 42431`; if it is NOT
  Moderato, fall back to a `defineChain` for Moderato and verify the connector
  accepts a hand-defined testnet chain. Override only the RPC via
  `transports: { [config.chainId]: http(config.rpcUrl || undefined) }`. The chain
  object's `.id` MUST equal `config.chainId` or the transport keying mismatches.
  (`makeChain(config)` stays ONLY for the `publicClient` + DevWallet path — do NOT
  feed it into the wagmi Config; the official chain object may carry Tempo
  extensions the connector relies on.)
- **Connector:** `connectors: [webAuthn()]` — NO `testnet` option (it does not
  exist), NO `authUrl` (backendless). **Network is selected purely by the chain
  object above, not by any connector flag.** If the ceremony needs a network hint
  it comes from the active chain in the wagmi Config.
- **Silent reconnect ENABLED, eager ceremony OFF:** wagmi does NOT auto-reconnect
  unless you call `reconnect()`. There is no `reconnectOnMount` flag. Call
  `useReconnect()` and fire `reconnect()` on mount, **gated on connection status**:
  only reconnect if `status === 'disconnected'` AND there is stored state — so
  re-invocation (StrictMode double-mount; N roots) is a no-op. Do NOT gate on a raw
  `useRef` boolean (a naive ref set in the effect body still double-fires under
  StrictMode mount→unmount→mount). §9 item 6 confirms: no double `credentials.get()`,
  no stuck `reconnecting`, no OS dialog on mount. If §9 shows reconnect cannot
  rehydrate without a ceremony, do NOT call `reconnect()`; accept
  click-to-connect-per-load.
- `multiInjectedProviderDiscovery: false` (embed must not attach to the host page's
  injected wallets).
- **Config memoisation keyed EXACTLY on transport-affecting fields:**
  `useMemo(() => makeWagmiConfig(config), [config.chainId, config.rpcUrl])`.
  Keying on full-`config` identity would drop an in-progress connection on every
  attribute mutation; keying only on `chainId` leaves a stale RPC.
  `anteAddress`/`tokenAddress`/`topic` changes must NOT tear down the wallet. The
  runtime teardown correctness of a chain switch is proven by §9 item 7 (a jsdom
  memo test only proves identity churn).
- **One Config per React root** (§1). wagmi **default storage** (no custom `key`)
  so same-origin Configs share one namespace for mount-time rehydrate. Do NOT set
  per-widget/per-chain storage keys (false isolation + reconnect thrash).
  `QueryClient` created once per root via `useState(() => new QueryClient())`.
- Order: `<WagmiProvider><QueryClientProvider>{children}</QueryClientProvider></WagmiProvider>`.

### `web/src/wallet/usePasskeyWallet.ts` (NEW)

Thin hook adapting standard wagmi hooks to the value `useAnte` needs. Localizes the
`wagmi`/`wagmi/tempo` imports; gives `useAnte` one object. NOT the retired OO seam;
NOT `Actions`.

```ts
export interface PasskeyWallet {
  address: `0x${string}` | undefined;
  isConnected: boolean;
  connect(): Promise<void>;                 // login only this round (§3)
  disconnect(): Promise<void>;
  /** Send raw {to,data,value}; resolves to the tx hash. Backed by path (a) or (b)
      per §9 item 1. Throws a clean "reconnect passkey" if no connection. */
  sendTx(tx: { to: `0x${string}`; data: `0x${string}`; value?: bigint }): Promise<`0x${string}`>;
}
export function usePasskeyWallet(): PasskeyWallet;
```

Implementation notes (pending §9 item 1 send-path decision):

- `const { address, status, isConnected } = useAccount();` — standard `wagmi` hook.
- `const { connectAsync } = useConnect();`
  `const { disconnectAsync } = useDisconnect();`
  `const connectors = useConnectors();` (single `webAuthn` connector).
- `sendTx` backing:
  - **path (a):** `const { data: walletClient } = useWalletClient();` (or, for
    bundle size, `getConnectorClient(config)` + viem's standalone `sendTransaction`
    action). `sendTx = (tx) => walletClient.sendTransaction({ to, data, value:
    value ?? 0n })`. Throw `"Passkey session lost — reconnect your passkey."` if
    the client is absent at call time.
  - **path (b):** `const sync = useSendTransactionSync();`
    `sendTx = (tx) => sync.mutateAsync({ calls: [{ to: tx.to, data: tx.data }] /*,
    feePayer, nonceKey per docs */ }).then(r => r.hash /* or documented shape */)`.
- `connect()` → `await connectAsync({ connector })` (login). Register is login-only
  this round (§3); no `capabilities`/name in the public surface unless §9 proves
  explicit register is required.
- Do NOT `await` anything between the click and the connector's sign call
  (transient user activation, §9 item 5).
- Header comment: `connect()`/`sendTx()` MUST be reached only from a user click.

## 3. Changed files

### `web/src/config/chain.ts`

- Remove the `turnkey?` block from `AnteConfig` (lines ~67–73).
- Remove `envTurnkey()` (lines ~92–99) and its `VITE_TURNKEY_*` reads.
- Remove `turnkey: envTurnkey()` from `defaultAnteConfig` (line ~130).
- Keep `devPrivateKey` / `envDevKey()`.
- **DELETE dead backward-compat exports** (grep-confirmed no importers, §0.0):
  `tempoTestnet` (line 175), `isChainConfigured` (line 196), and the `CHAIN_ID` /
  `RPC_URL` / `ANTE_ADDRESS` / `TOKEN_ADDRESS` block (lines 138–141). Keep exported:
  `AnteConfig`, `makeChain`, `defaultAnteConfig`, `isConfigured`, `ZERO_TOPIC`,
  `FALLBACK_ANTE_ADDRESS`, `FALLBACK_TOKEN_ADDRESS` (verify these last two have no
  importers before dropping; keep if used).
- **Update the line-47 comment** that names `selectWalletProvider` (it lists the
  consumers of `AnteConfig` — remove the stale name).
- Add `export const MAINNET_CHAIN_ID = 4217;` and a **local** helper
  `export function isMainnet(config: AnteConfig): boolean { return config.chainId
  === MAINNET_CHAIN_ID; }`. Keep it plain — it is a one-line pure function, not a
  "frozen contract" and needs no cycle-break ceremony. It IS consumed by
  `AnteWeb3Provider.tsx`, so `chain.ts` must be edited before that file typechecks
  (that is the only ordering constraint — §8).
- **Extend `makeChain`** to derive `name` + `testnet` from `isMainnet(config)`:
  `name = isMainnet(config) ? "Tempo" : "Tempo Testnet (Moderato)"`,
  `testnet = !isMainnet(config)`. Still used only by `publicClient` + DevWallet.
- No other signature changes.

### `web/src/config/AnteProvider.tsx`

- Wrap context children in `AnteWeb3Provider`:
  ```tsx
  return (
    <AnteConfigContext.Provider value={merged}>
      <AnteWeb3Provider>{children}</AnteWeb3Provider>
    </AnteConfigContext.Provider>
  );
  ```
- **Import path pinned:** `import { AnteWeb3Provider } from "../wallet/AnteWeb3Provider";`
  — the DIRECT path, NOT the barrel. Keeps the runtime ESM cycle to exactly two
  modules (`config/AnteProvider` ↔ `wallet/AnteWeb3Provider`, since
  `AnteWeb3Provider` imports `useAnteConfig` from `config/AnteProvider`). Safe: both
  reference the other ONLY inside a component body (no module-top-level eval), so
  ESM live-binding resolves it. Editing `AnteWeb3Provider.tsx` before this file (§8)
  makes the stub-commit ceremony unnecessary for a single linear branch.
- `useAnteConfig()` signature unchanged; it resolves to `merged`.

### `web/src/wallet/WalletProvider.ts` → **DELETE**

After Turnkey is gone the OO `WalletProvider` interface has one implementer and is
dead weight. Delete the file. No new `types.ts` module.

- `AnteTxRequest` (`{to,data,value?}`) is a trivial inline shape used in ~2 places.
  **Drop it as a named type**; inline `{ to: \`0x${string}\`; data:
  \`0x${string}\`; value?: bigint }` in the two `sendTx`/`signAndSend` signatures.
- `WalletKind`: define `export type WalletKind = "dev" | "passkey";` at the top of
  `DevWalletProvider.ts` (the module that owns the dev kind) and re-export it
  through the barrel. **Single canonical source** (no two definitions).

### `web/src/wallet/DevWalletProvider.ts` → **minimal edit**

Current file (verified): `implements WalletProvider` (line 22), imports
`{ AnteTxRequest, WalletProvider }` from `./WalletProvider` (line 11),
`readonly kind = "dev"` (line 23), `signAndSend(tx: AnteTxRequest)` (line 71),
constructor takes `(privateKey, config)` and builds `makeChain(config)`.

- Remove `implements WalletProvider` and the `./WalletProvider` import.
- Inline the `signAndSend` param type as `{ to: \`0x${string}\`; data:
  \`0x${string}\`; value?: bigint }` (was `AnteTxRequest`).
- Add `export type WalletKind = "dev" | "passkey";` at the top (canonical source).
- Keep `readonly kind = "dev" as const`, the constructor, and public methods
  (`fromConfig` / `connect` / `getAddress` / `getWalletClient` / `signAndSend`)
  unchanged. Its `signAndSend` IS the dev `sendTx`.

### `web/src/wallet/index.ts` (barrel)

- **Remove the `TurnkeyWalletProvider` import (line 9) and re-export (line 13).**
  These two specific lines are edited HERE as part of the same step that deletes
  `TurnkeyWalletProvider.ts` (§8) so the tree never imports a deleted module. See
  §8 for the two-owner note on this file.
- Remove the `WalletProvider`/`AnteTxRequest` re-export (line 11, module deleted).
- **Remove `selectWalletProvider`** (lines 39–47); `useAnte` calls
  `DevWalletProvider.fromConfig(config)` directly.
- `makePublicClient` stays **defined in this file** with `export function` — do NOT
  add `export { makePublicClient } from "./index"` (a module cannot re-export a name
  from itself).
- New export surface (frozen after §9):
  ```ts
  // makePublicClient is defined in THIS file via `export function` (no self re-export).
  export { DevWalletProvider, type WalletKind } from "./DevWalletProvider";
  export { AnteWeb3Provider } from "./AnteWeb3Provider"; // makeWagmiConfig NOT exported
  export { usePasskeyWallet, type PasskeyWallet } from "./usePasskeyWallet";
  // selectWalletProvider / TurnkeyWalletProvider / WalletProvider REMOVED.
  ```

### `web/src/hooks/useAnte.ts`

Core migration; preserve ALL feed-sync + read logic.

- Remove `selectWalletProvider` + `WalletProvider` imports and the
  `walletRef`/`getWallet()` lazy-select pattern (lines ~180, 219–230). Keep
  `makePublicClient`.
- Imports from `../wallet`: `{ usePasskeyWallet, DevWalletProvider,
  makePublicClient, type WalletKind }`.
- **`UseAnte.walletKind` (line 135) currently typed `WalletProvider["kind"] | null`
  — a type import from the to-be-DELETED `WalletProvider.ts`.** Replace with
  `WalletKind | null` from `../wallet` **in the same step the delete lands**
  (otherwise `useAnte` references a deleted type). Load-bearing coupling.
- Resolve the signer at render top-level as plain memos, with **`address` as a
  plain value, NOT an accessor that connects as a side effect** (simplicity major).
  Handle `connect()` explicitly at the call site:
  ```ts
  const passkey = usePasskeyWallet();
  const devWallet = useMemo(() => DevWalletProvider.fromConfig(config), [config]);
  const walletKind: WalletKind | null =
    devWallet ? "dev" : (passkey.address ? "passkey" : null);
  const signer = useMemo(() => (
    devWallet
      ? { address: devWallet.getAddress() ?? undefined,
          connect: () => devWallet.connect(),
          sendTx: (tx) => devWallet.signAndSend(tx) }
      : { address: passkey.address,
          connect: () => passkey.connect(),
          sendTx: passkey.sendTx }
  ), [devWallet, passkey.address, passkey.connect, passkey.sendTx]);
  ```
  The connect side effect stays VISIBLE at each write's preamble (below), not
  hidden in an accessor.
- **Address state** (label CHANGED). Dev path sets address synchronously on
  `connect()`. Passkey path lands address via an effect syncing `passkey.address`
  and firing `refreshModerator` once per address:
  ```ts
  useEffect(() => {
    if (devWallet) return;                 // dev path sets address on connect()
    setAddress(passkey.address ?? null);
    if (passkey.address) void refreshModerator(passkey.address);
  }, [devWallet, passkey.address, refreshModerator]);
  ```
  Remove per-write `setWalletKind`/`setAddress`/`refreshModerator` churn.
- **Config-change reset must also clear passkey-derived address state** so a
  `chainId` switch cannot leave a stale address (extend the existing
  `walletRef.current = null` effect on `[config]` to `setAddress(null)` on the
  non-dev path).
- **All six writes** (`ensureAllowance`, `post`, `withdraw`, `tip`, `flag`,
  `resolveFlag`) — connect explicitly, then send:
  ```ts
  let from = signer.address;
  if (!from) { await signer.connect(); from = signer.address; }
  // ... same parse / ensureAllowance / encodeFunctionData ...
  const hash = await signer.sendTx({ to, data });
  await getPublicClient().waitForTransactionReceipt({ hash });
  await loadComments();
  ```
  (For the passkey path, `signer.address` is captured from the render's
  `passkey.address`; after `connect()` the address lands via the effect and a
  subsequent render — if the connect-then-send in one handler needs the fresh
  address synchronously, read it from `connectAsync`'s result inside
  `usePasskeyWallet.connect()` and thread it back, decided at implementation.)
  `encodeFunctionData`, `ensureAllowance`, `waitForTransactionReceipt`,
  `loadComments` unchanged. No explicit `account`/`chain` passed to `sendTx`.
- `connect()` action (lines 456–468): dev key → `devWallet.connect()` + set
  address/kind + `refreshModerator`; else → `passkey.connect()` (the effect syncs
  state). Keep `setError`/rethrow.
- **No optional `register?`** on the public surface this round (add as a follow-up
  if §9 proves explicit register is required).

### `web/src/components/AnteComments.tsx`

- `WalletBadge` prop type: **widen the local inline union** `"dev" | "turnkey" |
  null` (line 112) → `WalletKind | null`. Importing `type WalletKind` from
  `../wallet` is OPTIONAL — only if the local prop is typed with the named type
  rather than the widened inline union. The load-bearing change is that
  `UseAnte.walletKind` (which this destructures at line 22) is now
  `WalletKind | null`; the badge must accept `"passkey"` instead of `"turnkey"`.
- Label ternary (line 119) `kind === "turnkey" ? "Passkey" : "Dev key"` →
  `kind === "passkey" ? "Passkey" : "Dev key"`.
- **Passkey caveat copy — BOTH axes + realm boundary (thesis major).** Render an
  always-visible line near the connect button covering the DOMAIN axis AND the
  DEVICE/authenticator axis AND the standalone≠embed realm boundary (§1). The copy
  MAY be reworded per §9 item 5's actual rpId scope, but it MUST always satisfy the
  grep gate's OR-set (§9): at least one **domain-axis** phrase from
  {`tied to this site`, `separate from any other Ante site`} AND one
  **device-axis** phrase from {`only on this device`, `where this passkey`}.
  Suggested copy:
  > `Your passkey and staked funds are tied to this site (separate from any other
  > Ante site, including the standalone app) and exist only on this device (or
  > wherever this passkey is synced). They cannot be recovered from another domain,
  > or if this passkey is lost.`
- The "Connect wallet" button already calls `connect()` from a click (transient
  activation preserved). No "Create passkey" button this round.
- **Invariant (verified satisfied):** no component in the widget tree may
  `createPortal` to `document.body`. webAuthn's native OS dialog is not
  DOM-rendered, so it is unaffected.

### `web/src/embed/ante-element.tsx`

- No provider wiring change (`AnteProvider` wraps `AnteWeb3Provider`).
- Update the header comment: "the Turnkey passkey flow works" → "the Tempo passkey
  (WebAuthn) flow works"; keep the top-level-origin rationale.
- No new HTML attributes (backendless). `observedAttributes` unchanged.
- **Invariants to state:**
  - `attributeChangedCallback` → `render()` is safe: the element/React root is
    stable, so an `ante-address`/`token-address` change re-renders WITHOUT tearing
    down `WagmiProvider` (Config memo keyed on `chainId`/`rpcUrl`).
  - A DOM move that remounts the React root (`disconnectedCallback` →
    `queueMicrotask` unmount → reconnect) **resets wallet connection state**; the
    shared storage + silent reconnect re-hydrate the address on remount (no new
    dialog — §9 item 8), but any in-progress ceremony is lost. Surviving an
    in-flight ceremony across remount is OUT OF SCOPE.
- Imports only `type AnteConfig` from `../config/chain` (line 6) — unaffected by
  the chain.ts export deletions.

### `web/src/App.tsx`

- No structural change. Optionally reword the "passkey-backed embedded wallet"
  prose (line ~21) to drop the Turnkey implication — cosmetic.

### `web/src/main.tsx`

- No edit expected. Listed for ownership only (§8).

### `web/src/vite-env.d.ts`

- Remove `VITE_TURNKEY_ORGANIZATION_ID`, `VITE_TURNKEY_API_BASE_URL`,
  `VITE_TURNKEY_RP_ID`, `VITE_TURNKEY_SIGN_WITH` (lines 10–15). Keep
  `VITE_DEV_PRIVATE_KEY` + the chain vars.

### `web/vite.embed.config.ts`

- Keep structurally (IIFE, `inlineDynamicImports: true`, the
  `process.env.NODE_ENV` define is REQUIRED — wagmi + react-query read it). Update
  the line-40 comment "inline any dynamic imports (Turnkey SDK)" → "inline any
  dynamic imports". Bundle grows (wagmi + viem + react-query + `accounts`) —
  acceptable.

### `web/package.json`

- Remove deps `@turnkey/sdk-browser`, `@turnkey/viem`.
- Add deps `accounts`, `wagmi`, `@tanstack/react-query`; bump `viem` (§5).
- Bump `typescript` to `~5.9.3` (wagmi peer).
- Scripts unchanged. Run `npm install` to regenerate `web/package-lock.json`.

### `web/tsconfig.json`, `web/tsconfig.app.json`, `web/tsconfig.node.json`

- Single owner. No change expected under normal resolution. IF `wagmi/tempo` /
  `wagmi/chains` do NOT resolve under `moduleResolution: "bundler"`, change
  `moduleResolution` to `"nodenext"` (or as §9 requires). Resolution failures are
  filed here.

### `.github/workflows/ci.yml`

- Delete the entire `server` job (lines 51–67). Keep `contracts` + `web`.
- **No on-chain e2e job** (simplicity major). The repo has ZERO frontend tests
  today; adding a secret + funded testnet account + skip-if-unset harness is
  net-new infra outside this refactor's goal and adds a flaky external dependency
  (faucet balance, RPC uptime) to CI. The write path is already covered by the 52
  forge tests plus the §9 manual passkey evidence. The `web` job gates on
  `npm run build` + `npm run build:embed` + `tsc` + the turnkey grep gate — those
  catch the real regressions.

## 4. Removed files / deps

- `web/src/wallet/TurnkeyWalletProvider.ts` — DELETE (deleted in the SAME step
  that removes its two barrel lines — §8).
- `web/src/wallet/WalletProvider.ts` — DELETE (`WalletKind` moved to
  `DevWalletProvider.ts`; `AnteTxRequest` dropped/inlined).
- `server/` — DELETE entire directory (Express app, `turnkey.ts`, package.json,
  package-lock.json, tsconfig.json, README.md, .env.example, node_modules).
- Deps removed from `web/package.json`: `@turnkey/sdk-browser`, `@turnkey/viem`.
- Env vars removed: `VITE_TURNKEY_ORGANIZATION_ID/_API_BASE_URL/_RP_ID/_SIGN_WITH`.
- Dead chain.ts exports removed: `tempoTestnet`, `isChainConfigured`, `CHAIN_ID`,
  `RPC_URL`, `ANTE_ADDRESS`, `TOKEN_ADDRESS`.

## 5. Dependency additions (exact versions)

Install the wrapper + `wagmi` at a floor satisfying `accounts`' peers; let
`accounts` supply the subpaths. Confirm subpaths at install (tsc), before provider
code.

| Package | Version | Notes |
|---|---|---|
| `accounts` | `~0.14.11` | Tempo Accounts SDK (thin wagmi wrapper). Provides `wagmi/tempo` (`webAuthn`, `tempoWallet` — BOTH from this subpath, NOT `wagmi/connectors`) and `wagmi/chains` (`tempo`, `tempoTestnet`, `tempoDevnet`, `tempoLocalnet`). `viem/tempo` surface is unverified — not used. Peers: `@wagmi/core >=3.4.3`, `wagmi >=0.0.0`. |
| `wagmi` | `^3.6.21` (floor satisfying `@wagmi/core >=3.4.3`) | Installs `@wagmi/core` transitively. Provides standard hooks (`useAccount`, `useConnect`, `useWalletClient`, `useSendTransactionSync`, `useReconnect`, …). |
| `@tanstack/react-query` | `^5.101.2` | wagmi peer `>=5.0.0`. |
| `viem` | bump `^2.21.0` → `^2.43.3` | **`viem 2.21` is INCOMPATIBLE with `accounts` (needs >=2.43.3) — MANDATORY.** Scan existing viem call sites for 2.21→2.43 breaking changes at install (§0.2 resolved-while-implementing). |

Peer alignment: `react >=18` OK (repo `^19.1.0`); `typescript >=5.9.3` — bump to
`~5.9.3`. After install, confirm `wagmi/tempo` and `wagmi/chains` resolve; if a
subpath fails, inspect the installed `exports` maps and file any tsconfig change.

## 6. Docs to update

- `web/.env.example`: delete the "Wallet: Turnkey passkey" section; keep
  `VITE_DEV_PRIVATE_KEY`; note the passkey path needs NO env (backendless).
- `web/EMBEDDING.md`: drop the Turnkey name; keep the HTTPS-required-for-passkeys
  section; line 5 "no backend" is now literally true (contingent on §9 item 4 —
  correct only benign wording if the RPC-only claim needs nuance; a hosted relay is
  an escalation, not a docs edit). **Add a required passkey section** stating the
  both-axis caveat (domain + device/authenticator) with the same substrings as the
  UI, the **standalone≠embed realm boundary** ("stakes on the blog embed are
  separate from the standalone app"), PLUS an operator warning about apex-vs-www /
  cross-subdomain identity (per the rpId scope from §9 item 5). Note that widgets
  on a page share an origin-scoped identity via mount-time storage read (NOT live
  cross-widget propagation).
- `web/README.md`: rewrite the Turnkey rows / env table / provider list to the
  wagmi webAuthn connector; note the dev fallback stays.
- `README.md` (root): delete the `server/` table row; reword Turnkey/server lines
  to the backendless wagmi webAuthn connector.
- `SPEC.md`: reword Turnkey references → official Tempo wagmi webAuthn passkey
  connector; dev fallback stays.
- `docs/tempo-facts.md`: **overwrite section 4** (accounts+turnkey adapter,
  `@turnkey/sdk-browser`, "Does Turnkey need a backend? YES") with the wagmi
  webAuthn facts: backendless local ceremony; `webAuthn`/`tempoWallet` from
  `wagmi/tempo`; the SEND PATH decision from §9 item 1 (path (a) raw sendTransaction
  OR path (b) `useSendTransactionSync({calls})`); standard `useAccount`/
  `useWalletClient` connection hooks (note `Hooks`/`Actions` namespaces EXIST but
  are Tempo protocol helpers we do not use); `wagmi/chains` `tempo` + `tempoTestnet`
  (with confirmed `.id`); domain+device-bound passkeys. **Record ALL §9 hard-gate
  answers** (send path; determinism a/b on Moderato; rpId scope; network check;
  realm-boundary standalone≠embed address diff; shadow-DOM reconnect behavior).
  Fix Turnkey rows/links throughout.
- `docs/mainnet-deploy.md`: light — no Turnkey name; "passkey Tempo Wallet can't
  sign forge — use a raw key" stays true.

## 7. Interface contracts (pin exact signatures — FREEZE ONLY AFTER §9)

> These must NOT be frozen until §9 confirms: the send path (item 1), hook shapes,
> subpath/chain export names (`tempoTestnet.id === 42431`), and the rpId scope.

### `config/chain.ts`

```ts
export interface AnteConfig { /* `turnkey` field REMOVED; everything else identical */ }
export const MAINNET_CHAIN_ID = 4217;                     // NEW
export function isMainnet(config: AnteConfig): boolean;   // NEW — local one-liner
export function makeChain(config: AnteConfig): Chain;     // derives name/testnet from isMainnet
export const defaultAnteConfig: AnteConfig;
export function isConfigured(config: AnteConfig): boolean;
export const ZERO_TOPIC: Hex;
// DELETED (dead, no importers): tempoTestnet, isChainConfigured,
//   CHAIN_ID, RPC_URL, ANTE_ADDRESS, TOKEN_ADDRESS.
// Verify FALLBACK_ANTE_ADDRESS / FALLBACK_TOKEN_ADDRESS importers before dropping.
// makePublicClient lives in wallet/index.ts (unchanged).
```

### `wallet/DevWalletProvider.ts` (owns the canonical `WalletKind`)

```ts
export type WalletKind = "dev" | "passkey";   // single canonical source
export class DevWalletProvider {
  readonly kind: "dev";
  constructor(privateKey: `0x${string}`, config: AnteConfig);
  static fromConfig(config: AnteConfig): DevWalletProvider | null;
  connect(): Promise<Address>;
  getAddress(): Address | null;
  getWalletClient(): WalletClient | null;
  signAndSend(tx: { to: `0x${string}`; data: `0x${string}`; value?: bigint }): Promise<Hash>;
}
// No longer `implements WalletProvider`; no import from ./WalletProvider.
```

### `wallet/AnteWeb3Provider.tsx`

```ts
export function AnteWeb3Provider(props: { children: React.ReactNode }): JSX.Element;
// makeWagmiConfig(config): Config is MODULE-PRIVATE.
```
`makeWagmiConfig` behaviour: `chains: [isMainnet(config) ? tempo : tempoTestnet]`;
`connectors: [webAuthn()]` (**no `testnet` option**; network from the chain);
`transports: { [config.chainId]: http(config.rpcUrl || undefined) }`;
`multiInjectedProviderDiscovery: false`; **default storage** (no custom key).
Provider tree `<WagmiProvider config><QueryClientProvider client>{children}</></>`.
Config memoised on `[config.chainId, config.rpcUrl]`. Silent reconnect on mount via
`useReconnect()` gated on `status === 'disconnected'` (contingent on §9 item 6);
eager ceremony never fires on mount.

### `wallet/usePasskeyWallet.ts`

```ts
export interface PasskeyWallet {
  address: `0x${string}` | undefined;
  isConnected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendTx(tx: { to: `0x${string}`; data: `0x${string}`; value?: bigint }): Promise<`0x${string}`>;
}
export function usePasskeyWallet(): PasskeyWallet;
// sendTx backing = path (a) or (b) per §9 item 1; the SIGNATURE is frozen either way.
```

### `wallet/index.ts` (barrel — frozen surface)

```ts
// makePublicClient is defined in THIS file via `export function` — NO self re-export.
export { DevWalletProvider, type WalletKind } from "./DevWalletProvider";
export { AnteWeb3Provider } from "./AnteWeb3Provider";
export { usePasskeyWallet, type PasskeyWallet } from "./usePasskeyWallet";
// selectWalletProvider / TurnkeyWalletProvider / WalletProvider REMOVED.
```

### Barrel import manifest (per consumer)

| Consumer file | Imports from `../wallet` (barrel) | Direct path | Notes |
|---|---|---|---|
| `config/AnteProvider.tsx` | — | `AnteWeb3Provider` from `../wallet/AnteWeb3Provider` | new edge (imports only `./chain` today) |
| `hooks/useAnte.ts` | `usePasskeyWallet`, `DevWalletProvider`, `makePublicClient`, `type WalletKind` | — | replaces `makePublicClient, selectWalletProvider, type WalletProvider`; **`UseAnte.walletKind` retyped `WalletProvider["kind"]\|null` → `WalletKind\|null`** |
| `components/AnteComments.tsx` | `type WalletKind` (OPTIONAL) | — | consumes `walletKind` via `useAnte()` return type; the `../wallet` import is only needed if the local `WalletBadge` prop is typed with the named `WalletKind`. Inline union widened `"turnkey"`→`"passkey"` regardless. |
| `wallet/AnteWeb3Provider.tsx` | (imports `isMainnet` from `../config/chain`; `useAnteConfig` from `../config/AnteProvider`; `webAuthn` from `wagmi/tempo`; `tempo`/`tempoTestnet` from `wagmi/chains`) | — | new file |
| `wallet/usePasskeyWallet.ts` | (standard hooks from `wagmi`; `webAuthn` from `wagmi/tempo`) | — | new file |

### `hooks/useAnte.ts` — `UseAnte` (external shape consumed by `AnteComments`)

Unchanged except `walletKind: WalletKind | null` (was `WalletProvider["kind"] |
null`). **No `register?`** this round. All action signatures
(`post`/`withdraw`/`tip`/`flag`/`resolveFlag`/`connect`/`refresh`/`rebuild`/`format`/`parse`)
identical.

## 8. Edit order + file ownership

This is a single-developer branch. The edit is ~14 files, sequential; the only
hard ordering constraints are the two ESM/type couplings below. No stub-first
commit, no atomic-barrel decree, no workstream fanout apparatus — a linear branch
resolves the cycle by editing files in order.

**Ordering constraints:**

- `chain.ts` (`isMainnet` / `MAINNET_CHAIN_ID`) MUST be edited before
  `AnteWeb3Provider.tsx` typechecks.
- `AnteWeb3Provider.tsx` MUST exist before `AnteProvider.tsx` imports it. (In a
  single linear branch, just edit the provider first — no passthrough stub needed.)
- `WalletProvider.ts` deletion + `WalletKind` move + `useAnte.ts` `walletKind`
  retype land TOGETHER (the type coupling in §0.0).
- `TurnkeyWalletProvider.ts` deletion + removal of its two lines in
  `wallet/index.ts` land TOGETHER (so the barrel never imports a deleted module —
  `wallet/index.ts` is thus touched in two logical steps: the Turnkey-removal step
  and the new-export-surface step; if fanned out, those two barrel edits are the
  ONLY shared-file overlap and must be one owner).

**Ordered edit list:**

1. **deps + cleanup.** `web/package.json`, `web/tsconfig*.json`,
   `.github/workflows/ci.yml` (delete `server` job; no e2e job),
   `web/src/vite-env.d.ts`, `web/vite.embed.config.ts`; delete `server/`; delete
   `web/src/wallet/TurnkeyWalletProvider.ts` AND remove its import/re-export lines
   in `web/src/wallet/index.ts`. `npm install`. Run the §9 spike.
2. **chain.ts.** Remove `turnkey`/`envTurnkey`; delete dead exports; add
   `MAINNET_CHAIN_ID` + `isMainnet`; extend `makeChain`; fix line-47 comment.
3. **wallet layer.** New `AnteWeb3Provider.tsx`; new `usePasskeyWallet.ts`;
   `DevWalletProvider.ts` minimal edit + `WalletKind`; delete `WalletProvider.ts`;
   finalize `wallet/index.ts` export surface.
4. **provider wiring.** `AnteProvider.tsx` wraps children in `AnteWeb3Provider`
   (direct path).
5. **hook + UI.** `useAnte.ts` (signer-at-render refactor, six writes, `walletKind`
   retype, address state machine); `AnteComments.tsx` (badge widen + both-axis
   caveat copy); `ante-element.tsx` (comment + invariants); `App.tsx` (cosmetic);
   `main.tsx` (none).
6. **docs.** Per §6 — final wording matches shipped API + §9 results.

**File-ownership map (disjoint; for parallel execution if fanned out).** If this is
run as parallel workstreams rather than a linear branch, use these disjoint sets in
dependency order. `wallet/index.ts` is the one two-touch file (see constraint
above); assign it a single owner who performs both the Turnkey-removal (step 1) and
the export-surface (step 3) edits.

- **W-deps** (files: `web/package.json`, `web/tsconfig.json`,
  `web/tsconfig.app.json`, `web/tsconfig.node.json`, `.github/workflows/ci.yml`,
  `web/src/vite-env.d.ts`, `web/vite.embed.config.ts`, `server/` (delete),
  `web/src/wallet/TurnkeyWalletProvider.ts` (delete)). dependsOn: none.
- **W-chain** (files: `web/src/config/chain.ts`). dependsOn: W-deps.
- **W-wallet** (files: `web/src/wallet/AnteWeb3Provider.tsx`,
  `web/src/wallet/usePasskeyWallet.ts`, `web/src/wallet/DevWalletProvider.ts`,
  `web/src/wallet/WalletProvider.ts` (delete), `web/src/wallet/index.ts`).
  dependsOn: W-chain, W-deps.
- **W-wire** (files: `web/src/config/AnteProvider.tsx`). dependsOn: W-wallet, W-chain.
- **W-ui** (files: `web/src/hooks/useAnte.ts`, `web/src/components/AnteComments.tsx`,
  `web/src/embed/ante-element.tsx`, `web/src/App.tsx`, `web/src/main.tsx`).
  dependsOn: W-wallet, W-chain. Internal order: `useAnte.ts` first (the badge type
  depends on `UseAnte.walletKind`).
- **W-docs** (files: `web/.env.example`, `web/EMBEDDING.md`, `web/README.md`,
  `README.md`, `SPEC.md`, `docs/tempo-facts.md`, `docs/mainnet-deploy.md`).
  dependsOn: none (wording matches shipped API + §9).

## 9. Test / verify strategy

### Pre-flight spike (BLOCKING — do before the wallet layer; §0.2)

Run against installed `node_modules`. Hard gates: send path (item 1); Moderato
determinism (item 2b); rpId-not-a-relay (item 3); no phone-home (item 4). Record
all answers in `docs/tempo-facts.md`. Shadow-DOM items (5–8) run in the EMBED shape
(built embed on a different-subdomain HTTPS host page). See §0.2 for full detail.

### Automated (must pass before merge)

- `cd web && npm install`; `npm ls wagmi viem @tanstack/react-query accounts`.
- `npm run build` — standalone (`tsc -b && vite build`).
- `npm run build:embed` — IIFE embed; confirm `dist-embed/ante.js` emits and
  wagmi/react-query/`accounts` inline cleanly under `inlineDynamicImports:true`.
- `cd contracts && forge test` — still green (52 tests).
- CI: `server` job removed; `contracts` + `web` jobs green. **No on-chain e2e job.**
- **Code grep gate (hard):** `grep -rn -i turnkey web/src` returns NOTHING.
- **Docs grep gate:** grep `README.md`, `SPEC.md`, `web/README.md`,
  `web/EMBEDDING.md`, `web/.env.example`, `docs/*.md` for `turnkey`; every hit MUST
  be an explicit historical/changelog mention. `tempo-facts.md` §4 and the
  "backend: YES" line must be gone/rewritten.
- **Warning-copy gate (BOTH axes, rewording-proof).** The copy MAY be reworded per
  §9 item 5, but grep of the built `dist/` AND `dist-embed/ante.js` MUST find, in
  BOTH bundles, at least one **domain-axis** phrase from the OR-set {`tied to this
  site`, `separate from any other Ante site`} AND at least one **device-axis**
  phrase from {`only on this device`, `where this passkey`}. This survives any
  §9-driven softening without silently reverting to thesis-silence.
- **Pure-function assertions** (cheap, no harness — a tiny script or inline check):
  `makeChain({chainId:4217,...}).testnet === false`; `isMainnet` true for 4217 /
  false for 42431.

**No mandated jsdom test harness (simplicity major).** The repo has ZERO frontend
tests and no test runner wired for `web`. Standing up jsdom + a runner + wagmi-hook
mocks is a larger lift than the runtime change it would guard (the memo-key
behavior is a two-line dependency array). The memo-key invariant is covered by a
code-review comment on the `useMemo` dependency array; the chain-switch teardown is
covered by §9 item 7 (real embed). If ONE optional smoke test is wanted later, keep
it optional, not a merge gate.

**No automated passkey-determinism test.** The thesis property (a credential-derived
stable address) cannot run headless (no WebAuthn in jsdom, and the connector's
derivation is not trivially mockable). It is proven ONLY by the Moderato manual
matrix (§9 item 2 a/b). Green CI is NOT thesis proof — the automated suite proves
build + shape, not identity determinism. Do not read green CI as thesis coverage.

### Manual (out of automated scope — GATED on merge via a required PR template)

Passkey ceremonies cannot run in CI. The PR body MUST include a filled evidence
table (the babysit/review step blocks on it).

- **HARD merge gate — Moderato leg, both surfaces.** For {standalone origin, embed
  origin} on Moderato: the connected address; a second-session re-login address
  (**must match** — determinism); a `post()` tx hash + explorer link; confirmation
  no OS dialog fired pre-click (silent reconnect); the observed rpId scope; the
  determinism matrix (a/b) from §9 item 2; and the **standalone-address ≠
  embed-address** assertion for the same authenticator (§9 item 5, realm boundary).
  This is free and fully proves the credential-derived-address thesis.
- **Post-launch smoke (NOT a merge gate) — mainnet.** Mainnet deploy is
  operator-gated and not yet live, and a mainnet ceremony would spend real pathUSD.
  Record a single throwaway re-login on mainnet in `docs/tempo-facts.md` AFTER
  launch, noting: "mainnet identity determinism is chain-independent — proven on
  Moderato; mainnet confirmed with a throwaway re-login, no stake required." Do NOT
  block merge on a real-money mainnet ceremony.

## 10. Risks + mitigations

- **Send path unproven.** §9 item 1 is a HARD GATE that empirically chooses path
  (a) raw `sendTransaction({to,data})` OR path (b) `useSendTransactionSync({calls})`
  BEFORE any wallet code. The `sendTx` signature is stable either way. If neither
  carries an arbitrary `{to,data}` write, STOP. (The dev CI/local path is a standard
  EOA WalletClient and would NOT surface a connector that rejects raw sends — hence
  the mandatory passkey spike.)
- **Domain + device/authenticator-bound passkeys / stake loss / realm split.** A
  passkey is bound to the origin's registrable domain AND the authenticator; the
  standalone and embed are DIFFERENT realms (§1). First-class deliverable:
  both-axis + realm-boundary UI copy (§3), EMBEDDING.md section incl. apex-vs-www
  and standalone≠embed (§6), rewording-proof both-axis grep gate (§9). No `authUrl`
  (would reintroduce a backend). Accepted tradeoff.
- **Deterministic identity.** Falsifiable matrix on Moderato (§9 item 2); (b) is a
  BLOCKER if the address depends on wagmi storage rather than the credential.
  Chain-independent, so Moderato proves it; mainnet is a post-launch smoke.
- **Backendless / pseudonymous is falsifiable and gated.** §9 items 3 (rpId not a
  hosted relay) and 4 (no phone-home beyond RPC) are HARD GATES — a thesis-breaking
  finding is an ESCALATION, not a docs edit. Only benign wording (registrable-domain
  vs hostname) is a docs fix.
- **Per-widget Config / cross-widget identity.** N Configs per page; identity shared
  via origin-scoped default storage AT MOUNT ONLY (no live cross-widget
  propagation; the `storage` event does not fire in the writing document). N× RPC/
  polling from per-root QueryClients accepted (≈1 widget per post). §9 item 6
  records reconnect behavior under StrictMode + N roots; a concurrent-reconnect race
  is the explicit fallback that would justify revisiting the "no shared hoist point"
  decision (and a per-origin shared Config+QueryClient singleton).
- **StrictMode double-invoke + N-root reconnect race.** `reconnect()` gated on
  `status === 'disconnected'` (not a raw boolean) so re-invocation is a no-op;
  `QueryClient` via `useState(()=>...)`, Config via `useMemo([chainId,rpcUrl])`.
  §9 item 6 asserts no double `credentials.get()` and no stuck `reconnecting`.
- **Runtime chain switch / Config teardown.** §9 item 7 flips `chain-id` in the
  real embed and confirms clean teardown (no orphaned listeners/timers). The memo
  identity churn is a code-review check, not a jsdom test.
- **DOM-move remount.** Resets connection state; storage + silent reconnect
  re-hydrate the address on remount without a new dialog (§9 item 8). In-flight
  ceremony survival across remount is OUT OF SCOPE.
- **Standalone + testnet must keep working.** The dev private-key path is preserved
  and selected whenever `devPrivateKey` is set, so local testnet e2e survives even
  if the passkey path has issues.
- **viem 2.21 INCOMPATIBLE with `accounts`.** Bump to `^2.43.3` mandatory; scan
  call sites at install.
- **wagmi 3.x TS peer (`>=5.9.3`).** Bump TS; owner of tsconfig handles any
  `moduleResolution` change if `wagmi/tempo`/`wagmi/chains` fail to resolve.
- **`tempoTestnet.id` may not be 42431.** §9 item 3 asserts it; if not, fall back
  to `defineChain` for Moderato and verify the connector accepts a hand-defined
  testnet chain. The wagmi chain object's `.id` MUST equal `config.chainId`.
- **Embed bundle size.** wagmi + viem + react-query + `accounts` inline into
  `ante.js`. Prefer `getConnectorClient` + standalone `sendTransaction` (or the
  `useSendTransactionSync` path) over the fat `useWalletClient` to limit attached
  wallet actions (§0.1 bundle note); decided by §9 item 1.
- **Shadow-DOM styling / transient activation.** webAuthn shows the native OS
  dialog (not DOM), so no body-portal risk. Invariant: nothing in the widget tree
  may portal to `document.body`. `connect()`/`sendTx()` run only from a real click
  with no `await` before the connector's sign call (§9 item 5).
