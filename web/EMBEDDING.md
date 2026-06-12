# Embedding Ante in a static blog (Hugo)

Ante ships as a self-contained **web component**, `<ante-comments>`. Drop one
`<script>` tag and one element onto any page and you get a per-post,
pseudonymous, stake-and-slash comment thread — no backend, no iframe.

Per-post threading is automatic: each page passes its `slug`, the component
hashes it to the on-chain `topic` (`keccak256(slug)`), and only that thread's
comments load. The topic flows: `slug` → `keccak256(toBytes(slug))` → indexed
`topic` arg on `post()` and on the `Posted` `eth_getLogs` filter.

---

## 1. Build the embed bundle

```bash
cd web
npm install
npm run build:embed
# → dist-embed/ante.js   (one self-contained IIFE; React bundled in)
```

`dist-embed/ante.js` is the only file you host. It self-registers the
`<ante-comments>` element on load and injects its own CSS into a **shadow root**,
so it cannot collide with (or be styled by) the host page.

> Vite's lib mode also emits a stray `dist-embed/ante-web.css`. It is **not
> needed** — the styles are already inlined into `ante.js` and injected into the
> shadow root. You can ignore or delete it.

## 2. Host it on the homelab behind Cloudflare

Serve `ante.js` as a static asset from any origin Cloudflare fronts (Pages, an
R2 bucket, or a homelab reverse proxy through a Cloudflare Tunnel). HTTPS is
required (passkeys won't work over plain HTTP) — Cloudflare gives you that for
free. Example homelab path:

```
cp dist-embed/ante.js  /srv/static/ante.js
# served at https://cdn.example.com/ante.js via the Cloudflare Tunnel ingress
```

Long-cache it like any hashed asset, or bust the cache by renaming on each
release (`ante.<version>.js`) and updating `script =` in your Hugo config.

## 3. Hugo snippet

A complete example lives in [`examples/hugo/`](./examples/hugo/). The essentials:

**Site config** (`config.toml` or `hugo.toml`):

```toml
[params.ante]
  address  = "0xYourAnteContractAddress..."   # deployed Ante
  token    = "0x20c0000000000000000000000000000000000000"  # stake token (pathUSD)
  rpc      = "https://rpc.moderato.tempo.xyz"  # Tempo testnet RPC (CORS! see below)
  chainId  = "42431"                            # Tempo testnet
  explorer = "https://explore.testnet.tempo.xyz"
  script   = "https://cdn.example.com/ante.js" # where you hosted the bundle
```

**Partial** (`layouts/partials/ante.html`) emits the element + loads the script
once per page:

```html
<ante-comments
  slug="{{ .Page.File.ContentBaseName }}"
  ante-address="{{ .Site.Params.ante.address }}"
  token-address="{{ .Site.Params.ante.token }}"
  rpc-url="{{ .Site.Params.ante.rpc }}"
  chain-id="{{ .Site.Params.ante.chainId }}"
></ante-comments>
```

Mount it in `layouts/_default/single.html`, after the article and before the
footer:

```html
{{ partial "ante.html" . }}
```

Or drop the shortcode into a post's Markdown body:

```
{{</* ante */>}}
```

Both the partial and the shortcode share a per-page `.Scratch` guard, so using
them together still loads `ante.js` only once.

### Attributes

| Attribute | Required | Meaning |
|---|---|---|
| `slug` | one of slug/topic | hashed to the on-chain topic (`keccak256(slug)`) |
| `topic` | one of slug/topic | raw `bytes32` topic (overrides `slug`) |
| `ante-address` | yes | deployed Ante contract |
| `token-address` | yes | stake token (TIP-20 stablecoin) |
| `rpc-url` | yes | Tempo RPC endpoint |
| `chain-id` | yes | chain id (decimal) |
| `explorer-url` | no | block explorer base URL |
| `dev-private-key` | no | **testnet demo only** — bundled into the page; never use a funded key |
| `is-moderator` | no | `true` forces the moderator panel on without the on-chain `moderators` read |

Omitting both `slug` and `topic` gives the global feed (every comment on the
contract) — useful for a single site-wide thread.

---

## 4. Operational notes

### RPC CORS (most common gotcha)

The widget calls the RPC **from the visitor's browser**, cross-origin
(`blog.example.com` → `rpc.moderato.tempo.xyz`). The RPC must return
`Access-Control-Allow-Origin` or the browser blocks every request and the widget
shows errors with nothing in the feed. Verify:

```bash
curl -sI -X OPTIONS https://rpc.moderato.tempo.xyz \
  -H 'Origin: https://blog.example.com' \
  -H 'Access-Control-Request-Method: POST' | grep -i access-control
```

If there's no `access-control-allow-origin` header, front the RPC with a thin
proxy that adds CORS headers — a **Cloudflare Worker** or a homelab reverse
proxy (nginx/Caddy `add_header Access-Control-Allow-Origin ...`) — and point
`rpc-url` at the proxy.

### Content-Security-Policy

If your blog sets a CSP, allow:

- `connect-src` → your RPC origin (e.g. `https://rpc.moderato.tempo.xyz` or your
  CORS proxy). Without it the JSON-RPC `fetch` is blocked.
- `script-src` → the origin hosting `ante.js` (e.g. `https://cdn.example.com`).

Example:

```
Content-Security-Policy:
  script-src 'self' https://cdn.example.com;
  connect-src 'self' https://rpc.moderato.tempo.xyz;
```

### HTTPS required for passkeys

The Turnkey embedded-wallet flow uses WebAuthn (Face ID / Touch ID), which the
browser only allows on a **secure context** (HTTPS, or `localhost` for dev).
Cloudflare covers HTTPS automatically.

### Why a web component (not an iframe)

**WebAuthn / passkeys are blocked in cross-origin iframes.** A custom element
runs in the host page's **top-level origin**, so the passkey flow works. We still
get full CSS isolation via the shadow root — the benefit of an iframe without the
WebAuthn penalty. (This is also why `dev-private-key` exists: a testnet-only
fallback for demos before passkeys are wired, and it is bundled into the page —
never put a real/funded key there.)
