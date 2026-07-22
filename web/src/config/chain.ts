import { defineChain, type Address, type Chain, type Hex } from "viem";

// ---------------------------------------------------------------------------
// Tempo testnet chain config.
//
// Every value here is overridable in two layers:
//   1. RUNTIME — an `AnteConfig` object (see `AnteConfig` below), supplied by
//      the embed web component via HTML attributes or by `<AnteProvider>`.
//   2. BUILD-TIME — `import.meta.env` (VITE_*), which seeds the defaults so the
//      standalone Vite app keeps working with zero wiring.
//
// Where the research agent has NOT yet verified a live value
// (docs/tempo-facts.md absent at build time), we fall back to a clearly-marked
// TODO(facts) placeholder. Do not trust the placeholder values for a real
// transaction — they must be supplied (via env or runtime config) first.
// ---------------------------------------------------------------------------

// Tempo Testnet ("Moderato"). Values verified against docs.tempo.xyz,
// ChainList and Chainstack (see docs/tempo-facts.md). Each is overridable.
const FALLBACK_CHAIN_ID = 42431; // 0xa5bf

const FALLBACK_RPC_URL = "https://rpc.moderato.tempo.xyz";

// Tempo MAINNET chain id (0x1089). Used to distinguish mainnet from the Moderato
// testnet at runtime (see `isMainnet`), which in turn selects the wagmi chain
// object and derives the viem chain `name`/`testnet` label in `makeChain`.
export const MAINNET_CHAIN_ID = 4217;

// Deployed Ante address — still a deploy-time output. Override with
// VITE_ANTE_ADDRESS (or the embed's `ante-address` attribute) once
// `forge script Deploy` has run. Zero keeps the "configure your env" banner up
// until then.
const FALLBACK_ANTE_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

// pathUSD — Tempo testnet stablecoin used for stakes (6 decimals, ERC-20).
// The faucet (tempo_fundAddress) dispenses it. Override with VITE_TOKEN_ADDRESS.
const FALLBACK_TOKEN_ADDRESS =
  "0x20c0000000000000000000000000000000000000" as Address;

const FALLBACK_EXPLORER_URL = "https://explore.testnet.tempo.xyz";

// bytes32 of all zeros — the "global feed" topic used when no per-post topic is
// supplied (standalone demo). post() always passes a topic; this is the no-op.
export const ZERO_TOPIC =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

// ---------------------------------------------------------------------------
// AnteConfig — the runtime configuration object.
//
// Threaded through React context (`<AnteProvider config={...}>`) and consumed by
// useAnte / makePublicClient / AnteWeb3Provider. The embed web component builds
// one of these from its HTML attributes; the standalone app uses the env-derived
// `defaultAnteConfig`.
// ---------------------------------------------------------------------------
export interface AnteConfig {
  rpcUrl: string;
  chainId: number;
  anteAddress: Address;
  tokenAddress: Address;
  explorerUrl: string;
  /** per-thread scope (bytes32). Omit/ZERO_TOPIC for the global feed. */
  topic?: Hex;
  /**
   * Blog author's wallet. Its earliest comment on a topic is treated as the
   * post ROOT (rendered as the header + "tip the author"), not a reply. Omit to
   * disable — the widget then behaves as a flat comment list.
   */
  authorAddress?: Address;
  /** dev-only fallback: 0x-prefixed testnet private key for a viem local account. */
  devPrivateKey?: Hex;
  /** force the moderator panel on without the on-chain `moderators(addr)` read. */
  isModerator?: boolean;
  /** optional deploy block to start the cold log-scan from (skips pre-deploy history). */
  deployBlock?: bigint;
  /** max block span per eth_getLogs window (default 9000). */
  logRange?: bigint;
}

// --- Env-derived defaults --------------------------------------------------

const envChainId: number = import.meta.env.VITE_CHAIN_ID
  ? Number(import.meta.env.VITE_CHAIN_ID)
  : FALLBACK_CHAIN_ID;

const envRpcUrl: string = import.meta.env.VITE_RPC_URL ?? FALLBACK_RPC_URL;

const envAnteAddress: Address = (import.meta.env.VITE_ANTE_ADDRESS ??
  FALLBACK_ANTE_ADDRESS) as Address;

const envTokenAddress: Address = (import.meta.env.VITE_TOKEN_ADDRESS ??
  FALLBACK_TOKEN_ADDRESS) as Address;

const envExplorerUrl: string = FALLBACK_EXPLORER_URL;

function envDevKey(): Hex | undefined {
  const raw = import.meta.env.VITE_DEV_PRIVATE_KEY;
  if (!raw) return undefined;
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

function envAuthorAddress(): Address | undefined {
  const raw = import.meta.env.VITE_AUTHOR_ADDRESS;
  return raw ? (raw as Address) : undefined;
}

/**
 * The build-time default config, derived entirely from `import.meta.env`. The
 * standalone `App.tsx` / `main.tsx` use this so they need no extra wiring; the
 * embed supplies its own AnteConfig instead.
 */
export const defaultAnteConfig: AnteConfig = {
  rpcUrl: envRpcUrl,
  chainId: envChainId,
  anteAddress: envAnteAddress,
  tokenAddress: envTokenAddress,
  explorerUrl: envExplorerUrl,
  topic: undefined,
  authorAddress: envAuthorAddress(),
  devPrivateKey: envDevKey(),
  isModerator:
    String(import.meta.env.VITE_IS_MODERATOR ?? "").toLowerCase() === "true"
      ? true
      : undefined,
  deployBlock: import.meta.env.VITE_DEPLOY_BLOCK
    ? BigInt(import.meta.env.VITE_DEPLOY_BLOCK)
    : undefined,
  logRange: import.meta.env.VITE_LOG_RANGE
    ? BigInt(import.meta.env.VITE_LOG_RANGE)
    : undefined,
};

/**
 * True when a config targets Tempo MAINNET (chain id 4217). Used to select the
 * network-specific wagmi chain object (`AnteWeb3Provider`) and to derive the viem
 * chain `name`/`testnet` label in `makeChain`. Pure one-liner — everything else
 * (RPC, addresses) is still config-driven, not branched on this.
 */
export function isMainnet(config: AnteConfig): boolean {
  return config.chainId === MAINNET_CHAIN_ID;
}

/**
 * Build a viem `Chain` from an AnteConfig.
 *
 * NOTE on the fee model: Tempo uses stablecoin-denominated gas (no volatile
 * native gas token; the Fee AMM auto-converts). viem still requires a
 * `nativeCurrency` field, so this is a LABEL ONLY — never use it for amount
 * math. All stake/tip amounts use the stake token's own `decimals()` (pathUSD
 * = 6), fetched at runtime in useAnte.
 */
export function makeChain(config: AnteConfig): Chain {
  const mainnet = isMainnet(config);
  return defineChain({
    id: config.chainId,
    name: mainnet ? "Tempo" : "Tempo Testnet (Moderato)",
    // Label-only (see note above). pathUSD is 6 decimals.
    nativeCurrency: {
      name: "USD stablecoin (gas)",
      symbol: "USD",
      decimals: 6,
    },
    rpcUrls: {
      default: { http: config.rpcUrl ? [config.rpcUrl] : [] },
    },
    blockExplorers: config.explorerUrl
      ? {
          default: { name: "Tempo Explorer", url: config.explorerUrl },
        }
      : undefined,
    testnet: !mainnet,
  });
}

/**
 * True when a config has the minimum facts needed to talk to chain. The UI uses
 * this to show a clear "configure your env" banner instead of throwing opaque
 * RPC errors against placeholder values.
 */
export function isConfigured(config: AnteConfig): boolean {
  // The only deploy-time-required value is the Ante address (zero until
  // deployed). The token just needs to be a real (non-zero) address — using the
  // verified pathUSD default is correct, NOT a sign of being unconfigured.
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  return (
    !!config.rpcUrl &&
    config.chainId !== 0 &&
    config.anteAddress.toLowerCase() !== ZERO_ADDRESS &&
    config.tokenAddress.toLowerCase() !== ZERO_ADDRESS
  );
}
