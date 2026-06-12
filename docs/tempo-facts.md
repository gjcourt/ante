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
| Turnkey embedded wallet | ✅ VERIFIED | adapter exists; official `with-tempo` example linked |
| Turnkey backend proxy needed? | ⚠️ PARTIAL | passkey login needs Turnkey **Auth Proxy** (hosted) + server for sub-org create; sponsorship needs a fee-payer backend. See §4/§5. |
| Fee sponsorship / paymaster | ✅ VERIFIED | Native fee-payer; public testnet sponsor service |
| EVM differences (Osaka) | ✅ VERIFIED | see §6 |
| Exact decimals (8 vs 18 rumors) | ✅ VERIFIED | **6** — confirmed by TIP-20 spec + Chainstack |

**UNKNOWNs to flag to build agents:**
- Deployed `Ante` contract address — N/A until contract agent deploys (use `VITE_ANTE_ADDRESS`).
- Whether `eth_getLogs` block-range limits apply on the public RPC — `UNKNOWN — needs manual check` (test against the endpoint).
- Exact Turnkey sub-org creation flow / whether Auth Proxy config covers Tempo out of the box — adapter is documented but the page self-flags as incomplete. Treat the dev-fallback (local private key) as the guaranteed path; Turnkey passkey path is real but verify against the live example.

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

## 4. Turnkey embedded wallet + passkey on Tempo

**Official example (VERIFIED):** `https://github.com/tkhq/sdk/tree/main/examples/with-tempo`
- It constructs a tx, **signs with Turnkey**, and broadcasts via Tempo's RPC. Node ≥ v20, pnpm.
- Env: `SIGN_WITH` (Turnkey wallet account address / private-key id; blank = auto-create) and optional `SPONSOR_WITH` (a Turnkey wallet address to sponsor fees).
- That example is a **Node script** (server-side signing), not a browser passkey demo — good reference for the signing call, but the browser passkey flow comes from the Turnkey browser SDK + the Tempo Accounts adapter below.

**Two integration paths:**

### (a) Tempo Accounts SDK with the Turnkey adapter (recommended for browser passkeys)
- npm package: **`accounts`** (unscoped; published by tempoxyz; v0.14.9 at verify time). Install: `npm i accounts`. Best used **with Wagmi**.
- Turnkey adapter docs: `https://accounts.tempo.xyz/docs/adapters/turnkey` (page self-flags as incomplete).
- Also needs Turnkey core: `@turnkey/core` (provides `TurnkeyClient`, `generateWalletAccountsFromAddressFormat`).
- Shape:

```tsx
import { Provider, turnkey } from 'accounts'
import { TurnkeyClient } from '@turnkey/core'

const provider = Provider.create({
  adapter: turnkey({
    client: new TurnkeyClient({ organizationId, authProxyConfigId }),
    createAccount: async ({ client, parameters }) => { /* passkey sign-up */ },
    loadAccounts:  async ({ client }) => { /* passkey login */ },
  }),
})
```

### (b) Turnkey browser SDK directly (the demo-embedded-wallet pattern)
- Packages: `@turnkey/sdk-browser`, `@turnkey/sdk-react`, `@turnkey/sdk-server`.
- Flow: passkey/WebAuthn auth → on first login, create a **sub-org + wallet** for the user → use the resulting address with viem against `tempoTestnet`.
- Reference demo (not Tempo-specific but the canonical passkey wallet flow): `https://github.com/tkhq/demo-embedded-wallet`.

### Does Turnkey need a backend? (⚠️ PARTIAL — important for the frontend agent)
- **Yes, in production.** The Turnkey **parent-org API key must never live in the browser.** Passkey login uses Turnkey's hosted **Auth Proxy** for account lookup, but **sub-org + wallet creation** (sign-up) is a privileged call that needs a small server holding the parent-org API key (the `@turnkey/sdk-server` piece).
- **Smallest viable backend:** one endpoint (Express / Hono / Next.js route) that uses `@turnkey/sdk-server` with the parent-org API key to (1) create a sub-organization + wallet for a new passkey user and (2) return the new sub-org/wallet id. Everything after that (signing) is done client-side via the user's passkey. This is the same server you can co-locate with the fee-payer relay (§5).
- **For Ante's MVP / "runs today" requirement:** the SPEC's **dev fallback (local viem account from `VITE_DEV_PRIVATE_KEY`) is the guaranteed end-to-end path** and needs **no backend**. Wire the full Turnkey passkey path behind the `WalletProvider` seam but don't block the demo on it.

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

**Relevance to Ante:** sponsorship is **optional**. With it, a user could post/tip without holding any stablecoin for gas (nice UX win for pseudonymous first-time commenters). Without it, the user just needs faucet pathUSD to cover sub-millidollar fees. The Turnkey `with-tempo` example's `SPONSOR_WITH` env var is the simplest sponsorship hook to copy.

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
- Tempo Accounts SDK / Turnkey adapter: https://accounts.tempo.xyz/docs and https://accounts.tempo.xyz/docs/adapters/turnkey
- Tempo Accounts SDK source: https://github.com/tempoxyz/accounts
- Turnkey `with-tempo` example: https://github.com/tkhq/sdk/tree/main/examples/with-tempo
- Turnkey demo embedded wallet: https://github.com/tkhq/demo-embedded-wallet
- ChainList (chain ID cross-check): https://chainlist.org/chain/tempo%20testnet
- Chainstack tutorial (decimals + RPC cross-check): https://docs.chainstack.com/docs/tempo-tutorial-first-payment-app
