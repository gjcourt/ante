# Self-hosting Ante

Ante is **self-hosted**: to put stake-to-comment on your blog you deploy your **own** contract and
drop a small `<script>` into your pages. There's no shared service to sign up for — your contract,
your moderation, your treasury, your rules. This guide takes you from zero to a working comment box.

Two ways through it:
- **[🤖 Cold-start with an AI agent](#-cold-start-with-an-ai-agent-easiest)** — paste one prompt into an
  agentic coding tool and it walks the whole thing.
- **[Manual](#manual-quick-start-single-owner)** — the same steps by hand.

> **Why your own contract?** A single Ante has one `owner`, one `treasury`, and one moderator set —
> authority and economics are global to the deployment. Sharing one contract would mean trusting its
> owner to moderate *your* blog and letting them collect *your* commenters' slashed stakes and tip
> skims. So for it to be yours, you deploy your own. (Comments are namespaced by post slug, so threads
> never collide — but that's threading, not ownership.)

---

## What you're signing up for

- **~5 minutes** to deploy + a few config values in your blog.
- **You're the moderator** — you slash spam/abuse with your key; nobody else can.
- **You're the treasury** — slashed stakes and the tip-fee skim flow to your address.
- **Commenters self-fund** — each commenter's browser passkey wallet needs a little pathUSD (the
  0.25 stake + gas). You don't fund them; on mainnet that's real money they bring.
- **It's unaudited** — see [`security-review.md`](./security-review.md). Real funds; your risk.

## Prerequisites

- **Foundry** — `curl -L https://foundry.paradigm.xyz | bash && foundryup` (gives you `forge`/`cast`).
- **The repo** — `git clone https://github.com/gjcourt/ante && cd ante`.
- **A blog that can host a static JS file** and set a handful of config values. Hugo is shown below;
  any static site works (the embed is a framework-agnostic web component).
- **pathUSD for gas.** Testnet ("Moderato") is free via a faucet. Mainnet is real money — you bridge
  it (Coinbase → USDC on Base → [Squid](https://app.squidrouter.com) → pathUSD).

**Always do testnet first, then mainnet.** Same steps, different `RPC_URL`.

| | RPC | chainId | pathUSD | funding |
|---|---|---|---|---|
| **Testnet** (Moderato) | `https://rpc.moderato.tempo.xyz` | 42431 | `0x20c0…0000` | `make fund` (faucet) |
| **Mainnet** | `https://rpc.tempo.xyz` | 4217 | `0x20c0…0000` | bridge real USDC → pathUSD |

---

## 🤖 Cold-start with an AI agent (easiest)

Fill in the `MY INPUTS` block and paste this into an agentic coding tool (e.g. Claude Code) running
in your `ante` clone. It prepares every command; **you** run the ones that broadcast or touch keys.

````text
You're helping me self-host Ante (github.com/gjcourt/ante), a stake-to-comment system, on my blog.
Cold-start it end to end from this repo clone. Read docs/SELF-HOST.md, docs/timelock-deploy-runbook.md,
and web/EMBEDDING.md first.

MY INPUTS
- Blog: <Hugo|other> at <path>; static files served from <dir>; live origin <https://myblog.example>.
- Roles: SIMPLE single-owner — I am owner + moderator; treasury = <my address, or "same as owner">.
  (If I say "hardened", use the timelock model in docs/timelock-deploy-runbook.md instead.)
- Networks: TESTNET (Moderato) first, then MAINNET after I've clicked through a real post.
- I run every broadcast/tx myself in my own terminal. You never see or store my private keys.

DO
1. Check foundry is installed (forge/cast); if not, give me the one-liner.
2. Make a throwaway deployer with `make wallet` (it only holds gas). Confirm my owner + treasury
   addresses. Prepare — never run — the deploy; deploys are operator-gated.
3. TESTNET: `make fund ADDR=<deployer>`, then give me the exact
   `make deploy RPC_URL=https://rpc.moderato.tempo.xyz OWNER=<me> TREASURY=<me> ACCOUNT=deployer
   SENDER=<deployer>` to run in my terminal. From my pasted output, read the Ante address + deploy
   block and run `make verify ANTE=<addr>`.
4. Wire the embed on a LOCAL/staging copy: `make web-embed`; host the built `ante.js`; set the blog's
   ante config (address, deploy block, token=pathUSD 0x20c0…0000, rpc, chainId, explorer); add the
   <ante-comments> snippet; enable comments on one test post. Have me connect a passkey and post, then
   verify on-chain (cast: nextId/comments/totalEscrowed) that my 0.25 stake landed.
5. MAINNET: repeat step 3 with RPC=https://rpc.tempo.xyz and CHALLENGE_WINDOW=604800; I bridge real
   pathUSD to the deployer first. Verify. Point the blog config at the mainnet address+block, rebuild
   the embed, ship.
6. Show me how to moderate (slash with my key) and link the deep docs.

GOTCHAS you must apply
- forge `--account` needs an explicit `--sender <addr>` (it can't derive it from a keystore pre-sign
  and aborts on its default-sender guard); a raw `--private-key` doesn't. Broadcasts run in a REAL
  terminal — the keystore password prompt needs a TTY, so don't try to run them for me.
- Single-owner `make deploy` is one tx (fine). The timelock path is multi-tx and OOGs without a gas
  multiplier — the Makefile bakes in `--gas-estimate-multiplier 800`; don't remove it.
- RPC CORS must allow my blog origin (`make cors-check ORIGIN=<origin>`); passkeys require HTTPS and
  are bound to the exact domain (localhost ≠ my blog — a fresh passkey per site).
- First post from any wallet = TWO confirmations (ERC-20 approve, then post); one thereafter.
- NEVER put a private key in the web build — `VITE_DEV_PRIVATE_KEY` stays empty on anything public.

Start by confirming my inputs, then walk me through testnet.
````

---

## Manual — quick start (single-owner)

The low-friction path: **one key controls everything** (owner = admin = first moderator), and a
treasury address receives slashed stakes. Good for a personal blog. (Harden to the timelock model
later if the stakes grow — see [below](#manual--hardened-timelock-optional).)

```sh
# 0. a throwaway deployer to pay gas (or use your own key)
make wallet                                   # prints ADDRESS + PRIVATE KEY — save the key
make fund ADDR=<deployer-address>             # testnet faucet → 1,000,000 pathUSD

# 1. deploy (testnet). OWNER = you (admin + moderator); TREASURY = where slashed stakes go.
make deploy \
  RPC_URL=https://rpc.moderato.tempo.xyz \
  OWNER=<your-address> TREASURY=<your-address> \
  PRIVATE_KEY=<deployer-key>                  # a raw key needs no SENDER; --account does (SENDER=0x…)

# 2. verify + record the printed Ante address and deploy block
make verify ANTE=<deployed-address> RPC_URL=https://rpc.moderato.tempo.xyz
```

Defaults you can override on the command line: `MIN_STAKE=250000` ($0.25, 6-dp pathUSD),
`CHALLENGE_WINDOW=86400` (1 day; use **604800** = 7 days on mainnet), `STAKE_TOKEN=pathUSD`.

**Mainnet** is the same command with `RPC_URL=https://rpc.tempo.xyz` and real pathUSD in the deployer
(bridge it first). Use a realistic `CHALLENGE_WINDOW` (e.g. `604800`). Run the broadcast in a real
terminal.

## Manual — hardened (timelock) [optional]

If you want key-theft protection (admin changes delayed + vetoable, treasury cold, moderator hot but
non-draining), use the two-key + `TimelockController` model instead of a single owner:

```sh
make deploy-timelock RPC_URL=… PROPOSER=… GUARDIAN=… MODERATOR=… TREASURY=… \
  TIMELOCK_DELAY=691200 CHALLENGE_WINDOW=604800 ACCOUNT=deployer SENDER=<deployer>
```

It costs more setup (a proposer + a separate guardian + moderator + treasury, and an 8-day delay on
admin changes). **Follow [`timelock-deploy-runbook.md`](./timelock-deploy-runbook.md)** — it documents
the roles, the verification, and the two Tempo deploy gotchas (`SENDER=` and the gas multiplier) the
target handles for you.

---

## Wire it into your blog

Full detail (CORS, CSP, HTTPS, hosting) is in **[`web/EMBEDDING.md`](../web/EMBEDDING.md)**. The short of it:

```sh
make web-embed          # → web/dist-embed/ante.js  (one self-contained bundle; React inside)
```

1. **Host `ante.js`** as a static file on your site (e.g. Hugo `static/ante.js` → served at `/ante.js`).
2. **Config** — the embed reads these as HTML attributes; wire them from your site config. Hugo
   `config.yaml`:
   ```yaml
   params:
     ante:
       address: "0xYourAnte…"     # your deployed contract
       block:   "<deploy-block>"  # feed scans logs from here (keep it in sync with the address)
       token:   "0x20c0000000000000000000000000000000000000"   # pathUSD
       rpc:     "https://rpc.tempo.xyz"
       chainId: "4217"
       explorer:"https://explore.tempo.xyz"
       script:  "/ante.js"
   ```
3. **Snippet** (a partial rendered on posts that opt in):
   ```html
   <ante-comments slug="{{ .File.ContentBaseName }}"
     ante-address="{{ .Site.Params.ante.address }}"
     token-address="{{ .Site.Params.ante.token }}"
     rpc-url="{{ .Site.Params.ante.rpc }}"
     chain-id="{{ .Site.Params.ante.chainId }}"
     deploy-block="{{ .Site.Params.ante.block }}"
     explorer-url="{{ .Site.Params.ante.explorer }}"></ante-comments>
   <script src="{{ .Site.Params.ante.script }}" defer></script>
   ```
4. **Enable per-post** with `comments: true` in the post's front matter (off by default).

**Three things that bite everyone** (all covered in EMBEDDING.md):
- **RPC CORS** must allow your blog's origin — `make cors-check ORIGIN=https://myblog.example`.
- **HTTPS is required** for passkeys (WebAuthn); they won't work over plain `http://` except `localhost`.
- **Passkeys are per-domain** — a passkey created on `localhost` is a *different* wallet than one on
  `myblog.example`. Commenters fund the wallet tied to your live domain.

---

## Operate it

- **Moderate.** A flagged comment is `Challenged`; resolve it with your moderator key
  (`cast send $ANTE 'resolveFlag(uint256,bool)' <id> <uphold> --account moderator …`). Uphold →
  stake slashed (bounty to the flagger, rest to treasury); reject → the flag bond is forfeit to
  treasury. On the single-owner setup, moderator == owner. Moderation is **not** timelocked.
- **Change a parameter** (min stake, window, tip fee). Single-owner: call the `setX` directly with the
  owner key. Timelock: `schedule` → wait `TIMELOCK_DELAY` → `execute` (see runbook §5).
- **Commenters reclaim** their stake with `withdraw(id)` after the challenge window (the widget does
  this for them).

## Deep dives

- **Hardened deploy** — [`timelock-deploy-runbook.md`](./timelock-deploy-runbook.md)
- **Embedding** (CORS/CSP/HTTPS/passkeys/hosting) — [`../web/EMBEDDING.md`](../web/EMBEDDING.md)
- **How it works + threat model** — [`../README.md`](../README.md), [`security-review.md`](./security-review.md)
- **Tempo specifics** (gas, pathUSD, funding) — [`tempo-facts.md`](./tempo-facts.md)
- **Architecture** — [`architecture.md`](./architecture.md)
