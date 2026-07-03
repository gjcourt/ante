# Mainnet Deploy Checklist

## ✅ DEPLOYED — 2026-07-01

Ante is live on **Tempo mainnet** (chain `4217`). Verified on-chain.

| Field | Value |
|---|---|
| **Ante contract** | `0x547C52db2555e5d6c33f0C2715380D0cceE19676` |
| **Deploy block** | `27964854` |
| **Deploy tx** | `0xe88cf7183e6e8854731a6de1ed2f333dec552d2956b2c86cd572c2ef00079790` |
| owner / treasury / moderator | `0x84961DAC4F7Fa4E11fed4c70E31f50EeB76f0c4f` (keystore `ante-deployer`) |
| stakeToken | pathUSD `0x20c0…0000` (6dp) |
| minStake | `250000` ($0.25) |
| challengeWindow | `604800` (7 days) |
| tipFeeBps | `1000` (10% — venue/creator cut → treasury; set 2026-07-02, tx `0x11de7760…`) |
| Deploy cost | ~$0.32 pathUSD |

Post-deploy owner change: `tipFeeBps` set from 0 → **1000 (10%)** via `setTipFeeBps(1000)`
(a tip splits 90% to the commenter, 10% to the treasury = the blog author, justified as a
venue cut). Testnet contract `0x353D…1345` set to match (tx `0x435dcab4…`).

Frontend `web/.env.local` wired to mainnet (dev key intentionally blank — see file).
The blog embed (`ante.js`) is chain-agnostic (config via HTML attributes), so **no rebuild
needed**; mainnet values go in burntbytes `[params.ante]`. Mainnet RPC CORS = `*` (no proxy).

Remaining: burntbytes `[params.ante]` → mainnet values + merge PR #3 + `comments: true`;
then the blog-post grounding section.

---

Deploying `Ante.sol` to **Tempo mainnet** (chain `4217`, RPC `https://rpc.tempo.xyz`).
Prior deploys were testnet-only (Moderato, chain `42431`). This is real money — go slowly,
double-check every address, and prefer a small test transfer before the full one.

Verified 2026-07-01: mainnet RPC responds (chain `4217`), and pathUSD is live at the same
precompile address as testnet — `0x20c0000000000000000000000000000000000000`, decimals `6`,
symbol `pathUSD`.

## Chosen parameters

| Param | Value | Notes |
|---|---|---|
| `STAKE_TOKEN` | `0x20c0…0000` | pathUSD, 6dp (same address on mainnet; Makefile default) |
| `MIN_STAKE` | `250000` | $0.25 — "a quarter" (Makefile default) |
| `CHALLENGE_WINDOW` | `604800` | **7 days**. This is the moderator's slash deadline before the author can reclaim. Tunable later via `setChallengeWindow` (`onlyOwner`). |
| `OWNER` | deployer address | admin + first moderator |
| `TREASURY` | deployer address | slash / forfeit sink |

Why 7 days: `challengeWindow` is *"seconds the moderator can slash before withdrawal unlocks."*
It's George's response deadline, not the flagger's — a bad comment not slashed/flagged within
the window becomes un-removable once the author reclaims the bond. 7 days matches a roughly
weekly checking cadence, the capital lock on a quarter-sized bond is negligible, and it's not a
one-way door (owner-settable post-deploy). Liveness caveat: flag *resolution* has no timeout in
the MVP, so responsiveness matters more on flagged (Challenged) comments than on the window.

## Funding: Coinbase USDC → pathUSD on the deployer

Coinbase can't withdraw directly to Tempo (not a supported network), so route through Base + Squid.
The deployer wallet stays purely on the Tempo side and only ever holds pathUSD; a separate
self-custody wallet does the bridging on Base.

- [ ] **1. Generate the deployer wallet.** `make wallet` → record the address **D** and private key
      (store securely, never commit). This is `OWNER` / `TREASURY` / moderator, and it signs the
      forge broadcast. (The passkey Tempo Wallet can't sign forge — must be a raw key.)
- [ ] **2. Withdraw USDC from Coinbase on the Base network** (~$12, covers the ~$10 target + bridge
      fees/slippage) to a self-custody wallet **M** (MetaMask or Coinbase Wallet).
      ⚠️ Select **Base** as the network — wrong network = lost funds.
- [ ] **3. Also send ~$1–2 of ETH on Base** to **M** for source-side bridge gas (Base gas is cents,
      but you can't sign a tx with zero native balance).
- [ ] **4. Bridge via Squid** ([app.squidrouter.com](https://app.squidrouter.com/)): connect **M**,
      source = **USDC on Base**, destination = **pathUSD on Tempo**, and set the
      **destination address = D**. One tx bridges + swaps into pathUSD, delivered to the deployer.
      Double-check the destination address; consider a small test amount first.
- [ ] **5. Confirm D holds pathUSD on Tempo.** pathUSD is both the stake token *and* the gas token
      (Tempo has no native gas coin), so this single balance covers deploy gas + stakes.

## Deploy

- [ ] **(Optional) Gas dry-run first.** Run the forge script *without* `--broadcast` against mainnet
      to get an actual gas estimate before spending. (Claude can do this once D exists.)
- [ ] **6. Broadcast** (operator-gated — George runs this with the deployer key):

      ```
      make deploy \
        RPC_URL=https://rpc.tempo.xyz \
        OWNER=0xYOUR_DEPLOYER \
        TREASURY=0xYOUR_DEPLOYER \
        CHALLENGE_WINDOW=604800 \
        PRIVATE_KEY=0xYOUR_KEY
      ```

      (`STAKE_TOKEN` and `MIN_STAKE` already default to the correct mainnet values.)
- [ ] **7. Record** the deployed Ante address and deploy block from the output.
- [ ] **8. Verify on-chain params:**

      ```
      make verify ANTE=0xDEPLOYED RPC_URL=https://rpc.tempo.xyz
      ```

      Confirm `challengeWindow = 604800`, `minStake = 250000`.

## Post-deploy wiring (Claude can drive these)

- [ ] **9.** Set `VITE_ANTE_ADDRESS` + `VITE_DEPLOY_BLOCK` in `web/.env.local` to the mainnet values;
      point the frontend chain config at mainnet (chain `4217`, `https://rpc.tempo.xyz`).
- [ ] **10.** Rebuild the embed: `npm run build:embed` → `dist-embed/ante.js`.
- [ ] **11.** Merge `gjcourt/burntbytes` PR #3, set the real Ante address in `[params.ante]`, enable
      `comments: true` on the Ante post.
- [ ] **12.** Finish the blog draft `~/src/life/writing/2026-06-12-ante-comments.md` — the grounding
      "what broke on deploy" section is writable once this is live.
