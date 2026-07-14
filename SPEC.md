# Ante — pseudonymous pay-to-comment with stake-and-slash on Tempo

**One-line:** To comment, you post a small refundable **stablecoin stake** on the Tempo chain. Good comments get the stake back (and can earn tips). Flagged-and-upheld comments get the stake **slashed**. No account, no real identity — just a pseudonymous passkey wallet (Tempo's official wagmi webAuthn connector, backendless). The bond is the reputation system, priced in dollars instead of karma points.

This is the shared spec. Three workstreams build against it in parallel, partitioned by directory so they never touch the same files:

| Dir | Owner | What |
|---|---|---|
| `contracts/` | contract agent | Foundry project: `Ante.sol` + tests + deploy script |
| `web/` | frontend agent | Vite + React + TS comment widget with a passkey wallet (wagmi webAuthn) |
| `docs/` | research agent | `tempo-facts.md` (verified live chain/wallet config) |

**Hard rules for all agents:** Self-verify your work by building/testing. If a live fact is unknown, leave a clearly-marked `TODO(facts)` and flag it in your summary — do not invent RPC URLs, token addresses, or chain IDs. (This repo is git-tracked with CI and PRs; the earlier "root is intentionally non-git" note is obsolete.)

---

## Design axes (context)

- **Sybil resistance = proof-of-stake (economic), not identity.** A funded wallet can post; throwaways are penalized by losing the stake. No personhood proof, no KYC. Good enough for a blog; ZK personhood is a later upgrade.
- **Anonymity = pseudonymous wallet.** The contract only ever sees an address. The address is a passkey wallet via Tempo's official wagmi **webAuthn** connector — backendless (the WebAuthn ceremony runs client-side, scoped to the origin's registrable domain; no API keys, no signup, no relay) — so the reader never installs MetaMask, never writes a seed phrase, and never reveals who they are. The address is derived from the credential, so returning to the same site on the same device recovers the same address (and stake).
- **Why Tempo:** stablecoin-denominated gas (no volatile gas token), sub-millidollar fees, sub-second finality, native wagmi passkey/webAuthn tooling, and optional fee sponsorship. It's purpose-built for exactly this micropayment pattern.

---

## On-chain model — `contracts/src/Ante.sol`

Solidity, Foundry, OpenZeppelin (`SafeERC20`, `ReentrancyGuard`, `Ownable`). The stake token is any ERC-20 stablecoin (TIP-20 on Tempo is ERC-20 compatible); the address is constructor-injected. Tests use a mock ERC-20.

### Storage
```solidity
enum Status { Active, Withdrawn, Slashed }

struct Comment {
    address author;     // pseudonymous passkey-wallet address
    uint96  stake;      // staked amount (token's smallest unit)
    uint64  postedAt;   // block.timestamp at post
    Status  status;
    bytes32 contentHash;// keccak256(bytes(content)) — integrity anchor
    uint256 tips;       // cumulative tips routed to author (for display)
}

IERC20  public stakeToken;
address public treasury;        // receives slashed stakes
uint256 public minStake;        // minimum to post
uint256 public challengeWindow; // seconds the moderator can slash before withdrawal unlocks
uint256 public nextId;          // monotonic comment id, starts at 1
mapping(uint256 => Comment) public comments;
mapping(address => bool) public moderators; // can slash
```

### Functions
```solidity
// post: pulls `stake` (>= minStake) via transferFrom; stores hash; emits content in the event.
// `topic` (indexed in Posted) scopes the comment to a thread — the frontend uses
// keccak256(post-slug) so each blog article has its own feed. Opaque to the contract.
function post(bytes32 topic, uint256 stake, string calldata content) external returns (uint256 id);

// withdraw: author reclaims stake after challengeWindow elapses, if still Active
function withdraw(uint256 id) external;

// slash: moderator only; while Active; routes stake -> treasury; status -> Slashed
function slash(uint256 id, string calldata reason) external;

// tip: anyone tips a comment's author; optional tipFeeBps share routed to treasury
function tip(uint256 id, uint256 amount) external;

// flag: STAKED. Flagger bonds funds to challenge an Active comment -> Challenged
//       (blocks the author's withdrawal until resolved). One open challenge at a time.
function flag(uint256 id, uint256 bond, string calldata reason) external;

// resolveFlag: moderator adjudicates. uphold=true -> slash comment, refund flagger's
//       bond + pay bounty (flagBountyBps of the stake), remainder -> treasury.
//       uphold=false -> flagger forfeits bond to treasury, comment returns to Active.
function resolveFlag(uint256 id, bool uphold, string calldata reason) external; // onlyModerator

// admin (onlyOwner): setMinStake, setMinFlagBond, setFlagBountyBps, setTipFeeBps,
//                    setChallengeWindow, setTreasury, setModerator(addr,bool)
```

**Symmetric staking:** accusing costs skin too. A flagger bonds (default `minFlagBond == minStake`); if the comment is upheld-bad they earn a bounty (default 50% of the slashed stake) and get their bond back; if the comment was fine they forfeit the bond. The moderator is still the adjudicator — staking disciplines *who flags*, not *who judges*. Forfeited bonds + slash remainders (+ optional tip fee) accumulate in the treasury, which can fund Tempo's gas-sponsor account. Direct `slash` (moderator removes without a challenge) remains for clear-cut cases.

> **Liveness note (future work):** while Challenged, the author's stake is locked pending the moderator's `resolveFlag`. A grief-flag is deterred economically (forfeited bond), but a *negligent* moderator could strand funds. A resolution-timeout that auto-rejects in the author's favor is the natural mitigation — intentionally out of MVP scope.

### Events (the frontend reads comments entirely from these — no backend DB)
```solidity
event Posted(uint256 indexed id, bytes32 indexed topic, address indexed author, bytes32 contentHash, string content, uint256 stake, uint64 postedAt);
event Withdrawn(uint256 indexed id, address indexed author, uint256 stake);
event Slashed(uint256 indexed id, address indexed author, uint256 stake, string reason);
event Tipped(uint256 indexed id, address indexed from, address indexed author, uint256 amount);
event Flagged(uint256 indexed id, address indexed flagger, string reason);
```

### Rules / invariants (cover these in tests)
- `post` reverts if `stake < minStake`; pulls exactly `stake`; `id` increments from 1; `contentHash == keccak256(bytes(content))`.
- `withdraw` reverts before `postedAt + challengeWindow`; reverts if not `Active`; reverts if caller != author; pays back exactly `stake`; sets `Withdrawn`.
- `slash` reverts if caller not a moderator; reverts if not `Active`; can fire during the window even after? — only while `Active` (i.e. before withdrawal); routes stake to `treasury`; sets `Slashed`.
- `tip` routes the full amount to the author; reverts on zero; works regardless of status (you can tip a withdrawn comment).
- Reentrancy-guarded around all token transfers; checks-effects-interactions ordering; `SafeERC20` everywhere.
- Content lives in the `Posted` event (cheap on Tempo). On-chain we keep only `contentHash` for integrity. No content string stored in storage.

### Future-work seam (note in code, do NOT implement today)
Optimistic challenge: a flagger posts a counter-stake; moderator resolution pays a bounty from the slashed stake or refunds the author. Leave `flag` + moderator-slash as the MVP path and a comment marking where the optimistic path would hook in.

### Deliverables (contract agent)
- `contracts/` initialized with Foundry (`forge init --no-git --no-commit` style; do NOT create a git repo).
- `src/Ante.sol`, `src/mocks/MockERC20.sol`.
- `test/Ante.t.sol` — full coverage of the invariants above. `forge test` MUST pass.
- `script/Deploy.s.sol` — deploys `Ante` taking `stakeToken`, `treasury`, `minStake`, `challengeWindow` from env vars.
- `contracts/README.md` — how to build, test, deploy (to Tempo testnet, RPC from env).
- After building, export the ABI to `contracts/out/Ante.sol/Ante.json` (forge does this) AND copy the ABI to `web/src/abi/Ante.json` so the frontend can import it. Create that path if needed.

---

## Frontend — `web/`

Vite + React + TypeScript. Onchain via **viem**; the passkey wallet via **wagmi** + Tempo's webAuthn connector (see below). A single embeddable comment widget plus a small demo page that mounts it.

### Wallet: passkey via Tempo's official wagmi webAuthn connector
- Use Tempo's official wagmi **webAuthn** connector (`webAuthn` from `wagmi/tempo`, provided by the `accounts` SDK) so the user signs in with Face ID / Touch ID and gets a wallet with no extension and no seed phrase. It is **backendless** — the WebAuthn ceremony runs client-side, scoped to the origin's registrable domain; no API keys, no signup, no `authUrl`. Wire it through an `AnteWeb3Provider` that builds a runtime wagmi `Config` from `AnteConfig` (chain selected by network, `http(rpcUrl)` transport, the single `webAuthn()` connector). Read connection state via standard wagmi hooks (`useAccount`, `useConnect`, `useWalletClient` / `useSendTransactionSync`). (`Hooks`/`Actions` namespaces also exist in `wagmi/tempo` for Tempo protocol helpers, but Ante's arbitrary contract writes do not use them.)
- **Pragmatic fallback (required so the app runs end-to-end today):** a dev fallback using a viem local account from a `VITE_DEV_PRIVATE_KEY` env var (testnet only), selected whenever the key is set. The UI must work end-to-end on testnet via the fallback even if a passkey ceremony is unavailable (e.g. CI). Both paths satisfy one stable seam — `{ address, sendTx({to,data,value}) }` — so every write is identical regardless of which wallet is active.

### Chain config — `web/src/config/chain.ts`
A viem `Chain` definition for Tempo testnet + the stake-token address + the deployed `Ante` address. Use `TODO(facts)` placeholders for any value the research agent hasn't verified yet; read overridable values from `import.meta.env` (`VITE_RPC_URL`, `VITE_ANTE_ADDRESS`, `VITE_TOKEN_ADDRESS`, `VITE_CHAIN_ID`).

### Component flows
1. **Read/list comments:** query `Posted` / `Slashed` / `Withdrawn` / `Tipped` logs via viem `getLogs` (or `watchEvent`), reconstruct each comment's current state, render newest-first with: content, short author address, stake amount, status badge (Active / Withdrawn / Slashed), tip total, and time.
2. **Post a comment:** textarea → "Stake $X to post" button → ensure ERC-20 `approve` allowance for the `Ante` contract → call `post(stake, content)` → optimistic-append on tx confirmation. Show the stake amount and that it's refundable.
3. **Withdraw:** if connected wallet is the author and `now > postedAt + challengeWindow` and status Active, show a "Reclaim stake" button → `withdraw(id)`.
4. **Tip:** a tip button on each comment → `approve` if needed → `tip(id, amount)`.
5. **Flag:** a "flag" affordance → `flag(id, reason)` (cheap, no payment) — sends the moderator a signal.

### UX notes
- Make the value proposition legible: "Your $X stake comes back unless your comment is flagged and removed." Show pending/confirming states. Handle the approve→post two-step gracefully (skip approve if allowance already sufficient).
- Amounts: read token `decimals()`; format/parse with viem `formatUnits`/`parseUnits`. Don't hardcode 18 or 6 — fetch it.
- Keep styling clean and self-contained (CSS modules or a single stylesheet). No heavyweight UI kit needed.

### Deliverables (frontend agent)
- `web/` Vite React-TS app that `npm install` + `npm run build` cleanly (no type errors).
- The wallet layer (`AnteWeb3Provider` + `usePasskeyWallet` for the wagmi webAuthn passkey, plus the `DevWalletProvider` dev fallback), `chain.ts`, `useAnte` hook (reads/writes via viem against the SPEC ABI — hand-write a minimal ABI matching the signatures above; integration will swap in the compiled `web/src/abi/Ante.json` if present), the `<AnteComments/>` widget, and a demo `App.tsx` mounting it.
- `web/.env.example` documenting every `VITE_*` var.
- `web/README.md` — run/build instructions and the env vars.

---

## Research — `docs/tempo-facts.md`

Verify against **live** docs (`docs.tempo.xyz`, `wagmi.sh/tempo`, `accounts.tempo.xyz`, Alchemy/Chainstack Tempo pages). Produce a concise facts sheet the other two consume. Required fields (mark anything unverifiable as `UNKNOWN — needs manual check`, never guess):
- Tempo **testnet**: network name, chain ID, RPC URL(s), block explorer URL, faucet URL, native/fee model (confirm stablecoin-gas, no native token).
- Testnet **stablecoin / TIP-20** token: address + decimals + symbol to use for stakes (or how to deploy/mint a test token if none canonical).
- A ready-to-paste **viem `Chain` definition** for Tempo testnet.
- **Passkey wallet** setup for Tempo: Tempo's official wagmi **webAuthn** connector (`webAuthn` from `wagmi/tempo`, provided by the `accounts` SDK), the required packages (`accounts`, `wagmi`, `@tanstack/react-query`, `viem >= 2.43.3`), that it is backendless (client-side WebAuthn ceremony, no API keys, no `authUrl` by default), the send-transaction primitive, the connection hooks, and the default `rpId` scope.
- **Fee sponsorship**: whether/how an app can sponsor the user's gas on Tempo testnet (paymaster-style), with the relevant API/contract if documented.
- Any EVM differences (Osaka hardfork notes) that affect a simple staking contract or viem usage.

Deliver `docs/tempo-facts.md`. Keep it skimmable — tables and code blocks over prose.
