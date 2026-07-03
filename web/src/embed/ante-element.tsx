import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { AnteComments } from "../components/AnteComments";
import { AnteProvider } from "../config/AnteProvider";
import { type AnteConfig } from "../config/chain";

// Widget + base styles imported as strings (Vite `?inline`) so we can inject
// them INTO the shadow root. This keeps blog styles and widget styles fully
// isolated in both directions — neither leaks across the shadow boundary.
import widgetCss from "../components/AnteComments.css?inline";
import baseCss from "../index.css?inline";

// ---------------------------------------------------------------------------
// <ante-comments> custom element.
//
// A drop-in web component for embedding the Ante widget in any static site
// (Hugo, etc.). It reads its config from HTML attributes, derives the per-post
// `topic` from `slug` (or takes a raw `topic`), attaches a shadow root, injects
// the widget CSS into that shadow root, and mounts the React widget there.
//
// Why a web component (not an iframe)? WebAuthn / passkeys are BLOCKED in
// cross-origin iframes. A custom element runs in the host page's top-level
// origin, so the Tempo passkey (WebAuthn) flow works. The shadow root still
// gives us CSS isolation without the cross-origin penalty.
//
// State invariants (see docs/plans/passkey-refactor.md §3 / §9 items 6–8):
//   - attributeChangedCallback → render() is SAFE for an ante-address /
//     token-address / topic change: the element and its React root are stable,
//     and the wagmi Config is memoised on chainId/rpcUrl only, so the
//     WagmiProvider (and any live passkey connection) is NOT torn down.
//   - A chain-id / rpc-url change DOES rebuild the Config (new network) and
//     tears down the old connection — intended.
//   - A DOM move that remounts the React root (disconnectedCallback →
//     queueMicrotask unmount → reconnect) RESETS in-memory wallet connection
//     state. The origin-scoped storage + silent reconnect re-hydrate the
//     address on remount with no new OS dialog. An in-flight ceremony does NOT
//     survive a remount — that is out of scope.
// ---------------------------------------------------------------------------

const TAG = "ante-comments";

/** keccak256(utf8 bytes of slug) — the per-thread topic. Matches the contract. */
function topicFromSlug(slug: string): Hex {
  return keccak256(toBytes(slug));
}

function readConfig(el: HTMLElement): { config: Partial<AnteConfig>; configured: boolean } {
  const attr = (name: string): string | undefined => {
    const v = el.getAttribute(name);
    return v == null || v === "" ? undefined : v;
  };

  const slug = attr("slug");
  const rawTopic = attr("topic") as Hex | undefined;
  // Prefer an explicit raw topic; otherwise hash the slug. Undefined → global feed.
  const topic: Hex | undefined = rawTopic ?? (slug ? topicFromSlug(slug) : undefined);

  const anteAddress = attr("ante-address") as Address | undefined;
  const tokenAddress = attr("token-address") as Address | undefined;
  const rpcUrl = attr("rpc-url");
  const chainIdRaw = attr("chain-id");
  const explorerUrl = attr("explorer-url");
  const devPrivateKey = attr("dev-private-key") as Hex | undefined;
  const isModerator = attr("is-moderator");
  const deployBlock = attr("deploy-block");
  const logRange = attr("log-range");

  const config: Partial<AnteConfig> = {};
  if (topic) config.topic = topic;
  if (anteAddress) config.anteAddress = anteAddress;
  if (tokenAddress) config.tokenAddress = tokenAddress;
  if (rpcUrl) config.rpcUrl = rpcUrl;
  if (chainIdRaw) config.chainId = Number(chainIdRaw);
  if (explorerUrl) config.explorerUrl = explorerUrl;
  if (devPrivateKey) config.devPrivateKey = devPrivateKey;
  if (isModerator != null) config.isModerator = isModerator.toLowerCase() === "true";
  if (deployBlock) config.deployBlock = BigInt(deployBlock);
  if (logRange) config.logRange = BigInt(logRange);

  // "configured" here just means the embed supplied the live addresses; the
  // widget still shows its own banner if they're missing.
  const configured = Boolean(anteAddress && tokenAddress && rpcUrl);
  return { config, configured };
}

class AnteCommentsElement extends HTMLElement {
  private root: Root | null = null;

  // Re-render when any config-bearing attribute changes after mount.
  static get observedAttributes(): string[] {
    return [
      "slug",
      "topic",
      "ante-address",
      "token-address",
      "rpc-url",
      "chain-id",
      "explorer-url",
      "dev-private-key",
      "is-moderator",
      "deploy-block",
      "log-range",
    ];
  }

  connectedCallback(): void {
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: "open" });
      // Inject base + widget CSS into the shadow root so host-page styles and
      // widget styles never collide (isolation in both directions).
      const style = document.createElement("style");
      style.textContent = `${baseCss}\n${widgetCss}`;
      shadow.appendChild(style);
      const mount = document.createElement("div");
      mount.className = "ante-embed-root";
      shadow.appendChild(mount);
      this.root = createRoot(mount);
    }
    this.render();
  }

  attributeChangedCallback(): void {
    // Only re-render once we're connected (root exists).
    if (this.root) this.render();
  }

  disconnectedCallback(): void {
    // Defer unmount out of the callback to avoid React's synchronous-unmount
    // warning, and guard against an immediate reconnect (move in the DOM).
    const root = this.root;
    this.root = null;
    queueMicrotask(() => {
      if (!this.isConnected) root?.unmount();
      else this.root = root; // reconnected before microtask — keep the root
    });
  }

  private render(): void {
    if (!this.root) return;
    const { config } = readConfig(this);
    this.root.render(
      <StrictMode>
        <AnteProvider config={config}>
          <AnteComments />
        </AnteProvider>
      </StrictMode>
    );
  }
}

// Self-register, guarding against a double-define (e.g. the bundle is included
// more than once on a page with multiple shortcodes).
if (typeof customElements !== "undefined" && !customElements.get(TAG)) {
  customElements.define(TAG, AnteCommentsElement);
}

export { AnteCommentsElement, TAG, topicFromSlug };
