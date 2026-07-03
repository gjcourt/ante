# Tempo Facts — verified chain / wallet config for Ante

> Research workstream output. The contract and frontend agents configure themselves from this file.
> **Do not invent values.** Anything not marked VERIFIED below is `UNKNOWN — needs manual check`.

## Confidence / last-verified

- **Last verified:** 2026-06-11 against live `docs.tempo.xyz`, `chainlist.org`, Chainstack docs, and `github.com/tkhq/sdk`.
- Tempo mainnet went live March 2026; **testnet is "Moderato"** and is the target for Ante.
- Values below were cross-checked across ≥2 independent sources where possible. Where a single doc page is the only source, it's noted.

| Field | Status | Value (short) |
|---|---|---|
| Testnet name | ✅ VERIFIED | Tempo Testnet (Moderato) |
| Chain ID | ✅ VERIFIED | **42431** (`0xa5bf`) |
| HTTP RPC | ✅ VERIFIED | `https://rpc.moderato.tempo.xyz` |
| WS RPC | ✅ VERIFIED | `wss://rpc.moderato.tempo.xyz` |
| Block explorer | ✅ VERIFIED | `https://explore.testnet.tempo.xyz` |
| Faucet | ✅ VERIFIED | API + `tempo_fundAddress` RPC (see below) |
| Fee model | ✅ VERIFIED | No native gas token; gas paid in TIP-20 stablecoins |
| Stake token (test stablecoin) | ✅ VERIFIED | pathUSD `0x20c0…0000`, **6 decimals** |
| viem Chain def | ✅ VERIFIED | see code block (built from verified values) |
| Passkey wallet | ✅ VERIFIED | Tempo's official wagmi **webAuthn** connector (`webAuthn` from `wagmi/tempo`, via the `accounts` SDK). See §4. |
| Passkey backend needed? | ✅ VERIFIED | **No** — backendless: client-side WebAuthn ceremony, no API keys, no signup, no `authUrl` by default. Only the RPC is contacted. See §4. |
| Fee sponsorship / paymaster | ✅ VERIFIED | Native fee-payer; public testnet sponsor service |
| EVM differences (Osaka) | ✅ VERIFIED | see §6 |
| Exact decimals (8 vs 18 rumors) | ✅ VERIFIED | **6** — confirmed by TIP-20 spec + Chainstack |

**UNKNOWNs to flag to build agents:**
- Deployed `Ante` contract address — N/A until contract agent deploys (use `VITE_ANTE_ADDRESS`).
- Whether `eth_getLogs` block-range limits apply on the public RPC — `UNKNOWN — needs manual check` (test against the endpoint).
- The `sendTx` primitive backing the passkey path is spike-decided (§4): either a raw viem `walletClient.sendTransaction({to,data,value})` OR wagmi's `useSendTransactionSync({ calls: [{to,data}] })`. Both satisfy the same `{to,data,value} → hash` seam. The dev-fallback (local private key) is the guaranteed CI/local path regardless.

---

## 1. Testnet network + fee model

| Property | Value |
|---|---|
| Network name | **Tempo Testnet (Moderato)** |
| Chain ID | **42431** (hex `0xa5bf`) |
| HTTP RPC | `https://rpc.moderato.tempo.xyz` |
| WebSocket RPC | `wss://rpc.moderato.tempo.xyz` |
| Block explorer | `https://explore.testnet.tempo.xyz` |
| Currency label | **USD** (not a tradeable native token — see below) |

**Fee model (VERIFIED):** "On Tempo, there is no native gas token." Transaction fees are paid **directly in supported USD stablecoins (TIP-20)**, with the protocol auto-converting between stablecoins via an on-chain Fee AMM. Consequences for code:
- There is no ETH-equivalent balance. `BALANCE`/`SELFBALANCE`/`CALLVALUE` opcodes **always return 0** (see §6).
- A wallet needs a TIP-20 stablecoin balance (e.g. pathUSD) to pay gas — fund via the faucet.

> ⚠️ Mainnet (for reference, **do not** use for Ante): name "Tempo Mainnet", chain ID **4217**, RPC `https://rpc.tempo.xyz`, explorer `https://explore.tempo.xyz`.

### Faucet (VERIFIED)

Dispenses **1M of each** test stablecoin per address (pathUSD, AlphaUSD, BetaUSD, ThetaUSD). Two ways:

```bash
# Option A — HTTP API
curl -X POST https://docs.tempo.xyz/api/faucet \
  -H "Content-Type: application/json" \
  -d '{"address": "<YOUR_ADDRESS>"}'

# Option B — RPC method (works with cast / any JSON-RPC client)
cast rpc tempo_fundAddress <YOUR_ADDRESS> --rpc-url https://rpc.moderato.tempo.xyz
```

Faucet docs page: `https://docs.tempo.xyz/quickstart/faucet`. Faucet only exists on testnet.

---

## 2. Stake token (testnet TIP-20 stablecoin)

Use **pathUSD** as the canonical stake token. TIP-20 **extends ERC-20** and is fully compatible with standard `approve` / `transferFrom` / `balanceOf` / `decimals` — exactly what `Ante.sol` (SafeERC20) needs. No special integration required for the staking flow.

| Token | Address (same on testnet & mainnet) | Decimals | Symbol |
|---|---|---|---|
| **pathUSD** (recommended) | `0x20c0000000000000000000000000000000000000` | **6** | pathUSD |
| AlphaUSD | `0x20c0000000000000000000000000000000000001` | 6 | AlphaUSD |
| BetaUSD | `0x20c0000000000000000000000000000000000002` | 6 | BetaUSD |
| ThetaUSD | `0x20c0000000000000000000000000000000000003` | 6 | ThetaUSD |

- **Decimals = 6** (USDC-style), VERIFIED against the TIP-20 spec ("Always returns 6 for TIP-20 tokens") and Chainstack. So `$1.00 = 1_000_000`.
- Frontend: still call `decimals()` at runtime per SPEC (`formatUnits`/`parseUnits`) — don't hardcode — but 6 is the expected value for `.env.example`.
- Contract tests can keep the mock ERC-20 at any decimals; deploy against pathUSD on testnet.

> Note: TIP-20 tokens are deployed as **precompiles** at fixed `0x20c0…` addresses. Treat them as normal ERC-20s from Solidity/viem; the payment-specific extensions (memos, policies) are opt-in and not needed by Ante.

---

## 3. viem `Chain` definition (ready to paste)

Built entirely from VERIFIED values above. Drop into `web/src/config/chain.ts`. Env overrides honored per SPEC.

```ts
import { defineChain } from 'viem'

export const tempoTestnet = defineChain({
  id: 42431,
  name: 'Tempo Testnet (Moderato)',
  // Tempo has no native gas token; fees are paid in TIP-20 stablecoins.
  // viem still requires a nativeCurrency object — this is a label only.
  nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.moderato.tempo.xyz'],
      webSocket: ['wss://rpc.moderato.tempo.xyz'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Tempo Explorer',
      url: 'https://explore.testnet.tempo.xyz',
    },
  },
  testnet: true,
})
```

> `nativeCurrency.decimals: 18` is a viem-required placeholder, **not** a real on-chain token. Never use it for amount math — use the TIP-20 token's `decimals()` (= 6). The stake/tip amounts in the contract are denominated in the stake token, not in any native unit.

To allow env overrides (SPEC asks for `VITE_RPC_URL` / `VITE_CHAIN_ID`):

```ts
const rpcUrl = import.meta.env.VITE_RPC_URL ?? 'https://rpc.moderato.tempo.xyz'
const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? 42431)
// then splice rpcUrl/chainId into defineChain(...) above
```

---

## 4. Passkey wallet — Tempo's official wagmi webAuthn connector

Ante uses Tempo's **official wagmi `webAuthn` connector** (from the `accounts`
SDK), NOT Turnkey. The connector is **backendless**: the WebAuthn ceremony runs
entirely client-side, scoped to the current origin's registrable domain — no API
keys, no signup, no `authUrl` by default, no hosted relay. The address is
derived from the WebAuthn credential, so returning to the same site on the same
device (or a synced authenticator) recovers the same address. There is no
`server/` and no `@turnkey/*` dependency.

> **Prior Turnkey approach REMOVED (round-4 refactor, 2026-07-01).** The
> half-built Turnkey embedded-wallet path (`accounts` + `turnkey` adapter,
> `@turnkey/*`, hosted Auth Proxy, sub-org-creation backend) was deleted in
> favour of the backendless wagmi webAuthn connector below. Kept only as a
> historical note so a reader isn't surprised the git history mentions Turnkey.

### Packages

| Package | Version | Provides |
|---|---|---|
| `accounts` | `~0.14.11` | Tempo Accounts SDK — a thin wagmi wrapper. Supplies the `wagmi/tempo` subpath (`webAuthn`, `tempoWallet`) and `wagmi/chains` (`tempo`, `tempoTestnet`, `tempoDevnet`, `tempoLocalnet`). |
| `wagmi` | `^3.6.21` | Standard hooks: `useAccount`, `useConnect`, `useDisconnect`, `useConnectors`, `useWalletClient`, `useSendTransactionSync`, `useReconnect`. |
| `@tanstack/react-query` | `^5.101.2` | wagmi peer. |
| `viem` | `^2.43.3` | **MANDATORY bump** from `2.21` — `accounts` needs `>= 2.43.3`. |

- **`webAuthn` AND `tempoWallet` both come from `wagmi/tempo`** (the subpath the
  `accounts` wrapper provides), NOT from `wagmi/connectors` (that is core wagmi's
  injected/walletConnect/coinbase connectors and does not export Tempo
  connectors). Ante uses only `webAuthn` this round.
- `webAuthn()` options (per docs): `authUrl`, `ceremony`, `icon`, `name`,
  `rdns`, `authorizeAccessKey`. **There is NO `testnet` option** — network is
  selected purely by the chain object in `chains: [...]`, never by a connector
  flag. Ante calls `webAuthn()` with no options (backendless default).
- Chain objects come from `wagmi/chains`: `tempo` (mainnet) and `tempoTestnet`
  (Moderato). There is **no `tempoModerato` export**. Assert `tempoTestnet.id ===
  42431` at install; if it differs, hand-define Moderato via `defineChain` and
  confirm the connector accepts it.
- Connection state is read via **standard `wagmi` hooks**. A `Hooks` namespace
  AND an `Actions` namespace also exist in `wagmi/tempo` (Tempo-specific
  token/dex/amm/wallet/fee/nonce protocol helpers) — they **exist but Ante does
  not use them**: there is no named Action for arbitrary writes like
  `post`/`withdraw`/`tip`/`flag`/`resolveFlag`/`approve`. (`viem/tempo` surface
  is unverified and unused.)

### Shape (what Ante builds)

```tsx
// AnteWeb3Provider.tsx (runtime-built from AnteConfig)
import { WagmiProvider, createConfig, http } from 'wagmi'
import { webAuthn } from 'wagmi/tempo'
import { tempo, tempoTestnet } from 'wagmi/chains'

const config = createConfig({
  chains: [isMainnet(cfg) ? tempo : tempoTestnet],
  connectors: [webAuthn()],                 // no testnet option; backendless
  transports: { [cfg.chainId]: http(cfg.rpcUrl || undefined) },
  multiInjectedProviderDiscovery: false,    // don't attach to host-page wallets
})
```

### §9 hard-gate answers (record here as the spike resolves them)

The refactor's §9 gates. Fill each cell from the real Moderato ceremony + embed
run; until then the DOCUMENTED expectation is noted so a reader knows the intended
answer and what would be a BLOCKER.

| Gate | Answer |
|---|---|
| **1. Send path** | The seam is `sendTx({to,data,value}) → hash`, stable either way. Documented primary API is wagmi's **`useSendTransactionSync({ calls: [{to,data}] })`** (path **b**) — the Tempo-native batched, fee-payer/nonce-keyed send. Whether the connector's viem `WalletClient` ALSO accepts a raw `sendTransaction({to,data,value})` (path **a**) is spike-decided. **DECISION: `TODO(spike) — record (a) or (b) after the Moderato ceremony`.** If NEITHER carries an arbitrary `{to,data}` write → BLOCKER. |
| **2a. Determinism — same browser, reload** | Expect **SAME address** (`TODO(spike): confirm on Moderato`). |
| **2b. Determinism — cleared localStorage, re-login** | Expect **SAME address** — proves the address derives from the credential, not wagmi cache. **If DIFFERENT/absent → thesis BROKEN, BLOCKER.** (`TODO(spike): confirm on Moderato`). |
| **2c. Second browser profile / synced authenticator** | SAME or DIFFERENT — recoverability boundary (`TODO(spike): one-line note`). |
| **2d. New device, no synced authenticator** | Expect DIFFERENT/absent — used to word the UI/docs caveat (`TODO(spike): note`). |
| **3. rpId scope** | Expect the **top-level origin's registrable domain** (e.g. `example.com`), NOT a Tempo-hosted relay. **If the default rpId is a hosted relay → thesis FALSE, BLOCKER (escalate).** Also record whether rpId is overridable without an `authUrl`. (`TODO(spike): record observed rpId`). |
| **4. No phone-home** | Expect NO requests to any `tempo.xyz` auth/attestation host beyond the RPC during connect or send (capture the network panel / run offline-after-load). **Any auth/attestation call → thesis FALSE, BLOCKER.** (`TODO(spike): record network evidence`). |
| **5. Standalone ≠ embed realm** | For the SAME authenticator, the standalone-origin address and the embed-host-origin address MUST **DIFFER** when the origins are different registrable domains (WebAuthn is domain-scoped). This is the falsifiable proof of the realm boundary; the UI + EMBEDDING.md caveat name it. (`TODO(spike): record both addresses, assert differ`). |
| **6. Shadow-DOM reconnect** | Silent reconnect at MOUNT rehydrates a prior address from origin-scoped storage with **no OS dialog** and no double `credentials.get()` under StrictMode / N roots. A live connect in one widget does **NOT** live-propagate to an already-mounted sibling (storage event doesn't fire in the writing document); the sibling picks it up only on its own mount/reconnect. (`TODO(spike): confirm no double dialog / no stuck reconnecting`). |

---

## 5. Fee sponsorship / paymaster (VERIFIED)

Tempo has **native, protocol-level fee sponsorship** (no ERC-4337 paymaster contract needed). It uses a dual-signature **TempoTransaction** (EIP-2718 type): the sender signs the tx, a **fee payer** counter-signs a "fee payer envelope" committing to pay that sender's fees. Sponsored txs omit `fee_token` from the sender's signing payload so the fee payer chooses it.

| Item | Value |
|---|---|
| Public **testnet fee-payer service** | `https://sponsor.moderato.tempo.xyz` |
| SDK (TS) | `accounts` (Tempo Accounts SDK) + Wagmi/viem |
| Self-hosted relay builder | `Handler.relay({ feePayer })` from the `accounts` server module |
| Backend required? | A fee-payer **does** sign server-side, but the **public testnet service** lets you sponsor without running your own. |

Wire-up (from Tempo docs):

```ts
// Client: route through the public testnet sponsor
tempoWallet({ feePayer: 'https://sponsor.moderato.tempo.xyz' })
// or, with a viem transport:
withRelay(http(), http('https://sponsor.moderato.tempo.xyz'))
```

**Relevance to Ante:** sponsorship is **optional** and NOT wired this round. With it, a user could post/tip without holding any stablecoin for gas (nice UX win for pseudonymous first-time commenters). Without it, the user just needs faucet pathUSD to cover sub-millidollar fees. If added later, route through the public testnet sponsor service (`tempoWallet({ feePayer: 'https://sponsor.moderato.tempo.xyz' })`) — no self-hosted relay needed.

---

## 6. EVM differences (Osaka) affecting the contract / viem

Tempo targets the **Osaka** EVM hardfork. **No new opcodes** were added (account-abstraction features come via the new TempoTransaction type, not opcodes), so Solidity/Foundry/viem all work normally. Caveats that matter for `Ante.sol` and the frontend:

| Difference | Detail | Impact on Ante |
|---|---|---|
| No native gas token | `BALANCE`, `SELFBALANCE`, `CALLVALUE` **always return 0** | Ante never reads native balance or uses `msg.value` — **no impact**. Don't add `payable`/value checks. |
| Gas in stablecoins | Fees paid in TIP-20; needs faucet balance | Deploy/test wallet must hold pathUSD. |
| Higher state-creation gas (TIP-1000) | New storage slot (0→non-zero) **250k gas** (vs 20k); account creation **250k gas**; contract-create **1,000 gas/byte** (vs 200) | `post()` writes a new `Comment` struct (several fresh slots) → noticeably pricier than mainnet-EVM, but still sub-cent given stablecoin fees. **Set generous gas limits**; don't hardcode tight estimates. Deployment costs 5–10× Ethereum. |
| `transfer`/`transferFrom`/`approve` | Standard ERC-20 semantics intact on TIP-20 | SafeERC20 flow works unchanged. |
| viem | Standard methods work; just point at the verified RPC/chain | Use the §3 chain. If you later use TempoTransaction features (sponsorship/batching) you need the `accounts`/Wagmi-Tempo helpers, not plain viem. |

**Net:** a vanilla ERC-20 stake/slash/tip contract compiled for the Osaka/`cancun`+ Solidity target works as-is. The only practical adjustment is **gas budgeting** (state writes are ~12× pricier) and ensuring the deployer wallet holds a TIP-20 stablecoin for fees.

---

## Quick `.env` cheat-sheet for the build agents

```bash
# web/.env  (frontend)
VITE_CHAIN_ID=42431
VITE_RPC_URL=https://rpc.moderato.tempo.xyz
VITE_TOKEN_ADDRESS=0x20c0000000000000000000000000000000000000   # pathUSD, 6 decimals
VITE_ANTE_ADDRESS=                                               # fill after deploy
VITE_DEV_PRIVATE_KEY=                                            # testnet dev-fallback wallet

# contracts (deploy env)
TEMPO_RPC_URL=https://rpc.moderato.tempo.xyz
STAKE_TOKEN=0x20c0000000000000000000000000000000000000          # pathUSD
# TREASURY / MIN_STAKE / CHALLENGE_WINDOW per your deploy choices
```

## Sources
- Tempo connection details: https://docs.tempo.xyz/quickstart/connection-details
- Faucet: https://docs.tempo.xyz/quickstart/faucet
- EVM differences: https://docs.tempo.xyz/quickstart/evm-compatibility
- TIP-20 spec (decimals = 6): https://docs.tempo.xyz/protocol/tip20/spec
- Native stablecoins: https://docs.tempo.xyz/learn/tempo/native-stablecoins
- Fee sponsorship: https://docs.tempo.xyz/guide/payments/sponsor-user-fees
- Tempo Accounts SDK docs: https://accounts.tempo.xyz/docs
- Tempo Accounts SDK source: https://github.com/tempoxyz/accounts
- wagmi + Tempo (webAuthn connector, `useSendTransactionSync`): https://wagmi.sh/tempo
- ChainList (chain ID cross-check): https://chainlist.org/chain/tempo%20testnet
- Chainstack tutorial (decimals + RPC cross-check): https://docs.chainstack.com/docs/tempo-tutorial-first-payment-app
