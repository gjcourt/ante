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

// Deployed Ante address — still a deploy-time output. Override with
// VITE_ANTE_ADDRESS (or the embed's `ante-address` attribute) once
// `forge script Deploy` has run. Zero keeps the "configure your env" banner up
// until then.
export const FALLBACK_ANTE_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

// pathUSD — Tempo testnet stablecoin used for stakes (6 decimals, ERC-20).
// The faucet (tempo_fundAddress) dispenses it. Override with VITE_TOKEN_ADDRESS.
export const FALLBACK_TOKEN_ADDRESS =
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
// useAnte / makePublicClient / selectWalletProvider. The embed web component
// builds one of these from its HTML attributes; the standalone app uses the
// env-derived `defaultAnteConfig`.
// ---------------------------------------------------------------------------
export interface AnteConfig {
  rpcUrl: string;
  chainId: number;
  anteAddress: Address;
  tokenAddress: Address;
  explorerUrl: string;
  /** per-thread scope (bytes32). Omit/ZERO_TOPIC for the global feed. */
  topic?: Hex;
  /** dev-only fallback: 0x-prefixed testnet private key for a viem local account. */
  devPrivateKey?: Hex;
  /** force the moderator panel on without the on-chain `moderators(addr)` read. */
  isModerator?: boolean;
  /** optional deploy block to start the cold log-scan from (skips pre-deploy history). */
  deployBlock?: bigint;
  /** max block span per eth_getLogs window (default 9000). */
  logRange?: bigint;
  /** Turnkey embedded-wallet config (passkey path). All four required to enable. */
  turnkey?: {
    organizationId: string;
    apiBaseUrl: string;
    rpId: string;
    signWith: Address;
  };
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

function envTurnkey(): AnteConfig["turnkey"] {
  const organizationId = import.meta.env.VITE_TURNKEY_ORGANIZATION_ID;
  const apiBaseUrl = import.meta.env.VITE_TURNKEY_API_BASE_URL;
  const rpId = import.meta.env.VITE_TURNKEY_RP_ID;
  const signWith = import.meta.env.VITE_TURNKEY_SIGN_WITH;
  if (!organizationId || !apiBaseUrl || !rpId || !signWith) return undefined;
  return { organizationId, apiBaseUrl, rpId, signWith: signWith as Address };
}

function envDevKey(): Hex | undefined {
  const raw = import.meta.env.VITE_DEV_PRIVATE_KEY;
  if (!raw) return undefined;
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
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
  turnkey: envTurnkey(),
};

// --- Backwards-compatible named exports ------------------------------------
// These keep older imports (and any not-yet-migrated call sites) working. They
// reflect the env-derived defaults only — runtime overrides flow through the
// AnteConfig object, not these constants.

export const CHAIN_ID: number = defaultAnteConfig.chainId;
export const RPC_URL: string = defaultAnteConfig.rpcUrl;
export const ANTE_ADDRESS: Address = defaultAnteConfig.anteAddress;
export const TOKEN_ADDRESS: Address = defaultAnteConfig.tokenAddress;

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
  return defineChain({
    id: config.chainId,
    name: "Tempo Testnet (Moderato)",
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
    testnet: true,
  });
}

/** viem `Chain` for the env-derived default config (standalone app convenience). */
export const tempoTestnet: Chain = makeChain(defaultAnteConfig);

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

/** Backwards-compatible: configured state of the env-derived default config. */
export const isChainConfigured: boolean = isConfigured(defaultAnteConfig);
