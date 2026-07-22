# Plan — Post as Root Comment (v1, lightweight)

## Goal

Make the blog post itself present as the **root** of its Ante thread: an on-chain
comment, authored (and staked) by the site author, rendered as the post header with
a **Tip the author** affordance. Replies render beneath it. Turns the widget from
"comments under a post" into "the post is the first stake," and makes the author
tippable natively (no venue-fee hack, no self-comment-in-the-list).

## Non-goals (explicitly v2 — need a contract change, out of scope here)

- Nested reply threading (replies referencing the root on-chain via a `parentId`).
- Enforced/adjudicated self-stake (author is still the sole moderator → the root
  stake is a **commitment signal**, not an enforced bond).
- Post body on-chain (the essay stays in Hugo; the root only anchors title + URL).

## Key property

**No contract change.** Uses the deployed mainnet contract's existing
`post(bytes32 topic, uint256 stake, string content)` and `tip(uint256 id, uint256 amount)`.
The "root" is just the author's earliest comment on a topic, identified by a new
config value; everything else is frontend + config + one publish step.

## Changes

### 1. Config — `web/src/config/chain.ts`
- Add `authorAddress?: Address` to `AnteConfig`.
- Add `envAuthorAddress()` reading `VITE_AUTHOR_ADDRESS` (standalone default), wire
  into `defaultAnteConfig`.
- `.env.example`: document `VITE_AUTHOR_ADDRESS`.

### 2. Embed attribute — `web/src/embed/ante-element.tsx`
- Add `author-address` to `observedAttributes`.
- Parse it into `config.authorAddress` alongside the other address attrs.

### 3. Root derivation — `web/src/hooks/useAnte.ts`
- Add `rootComment: AnteComment | null` to `UseAnte`.
- Compute via `useMemo`: if `config.authorAddress` set, `rootComment` = the comment
  in `comments` with the **lowest id** whose `author === authorAddress`; else `null`.
  (Lowest id = earliest posted; later author comments stay normal replies.)
- No change to feed fetching — the root is already in the topic's `comments`.

### 4. Render — `web/src/components/AnteComments.tsx`
- If `rootComment` present, render a **header block** above the composer:
  - the root `content` (author's title + link),
  - "✍ The author staked `{format(stake)} {symbol}` on this post" (reuse the
    stake-multiple understatement rules already in `CommentRow`),
  - optional "· received `{format(tips)}` in tips" when `tips > 0`,
  - a **Tip the author** control reusing the existing `CommentRow` tip UI
    (`tipOpen`/`tipAmount` → `onTip(rootComment.id, amount)`).
- Filter the root out of the reply list: `comments.filter(c => c.id !== rootComment?.id)`.
- Empty-state + composer copy: "reply" framing when a root exists
  ("Be the first to reply" / "Stake … to reply").

### 5. Publish step (docs only — no tooling required for v1)
- Author posts the root once per post, from the moderator/deployer wallet:
  ```
  TOPIC=$(cast keccak "<slug>")
  cast send <ANTE> "post(bytes32,uint256,string)" "$TOPIC" <stake> \
    "<Post title> — <canonical url>" --rpc-url <rpc> --account ante-deployer
  ```
- Set `author-address` in burntbytes `[params.ante]` to that wallet.
- (Alternative: post the root from the widget's passkey; then author-address = the
  passkey address. Deployer-via-cast is the canonical path, consistent with other ops.)

## Test / verify
- `npm run build` AND `npm run build:embed` green (tsc -b — not `tsc --noEmit`).
- Standalone dev against testnet: set `VITE_AUTHOR_ADDRESS` to a wallet, post a
  "root" comment from it, confirm it renders as the header (not in the list), the
  Tip-the-author button calls `tip(rootId)`, and replies render below.
- Graceful fallback: with no `author-address`, or before any author comment exists,
  the widget behaves exactly as today (flat list, no header).

## Risks / notes
- Root stake is a commitment signal only (author = moderator). Say so in the UI copy
  and the blog post; don't overclaim enforcement.
- If the author leaves normal comments too, only the lowest-id author comment is the
  root — intended.
- `author-address` mismatch (wrong case) → use `.toLowerCase()` comparison.
