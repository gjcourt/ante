import { createPublicClient, http, type PublicClient } from "viem";
import {
  defaultAnteConfig,
  makeChain,
  type AnteConfig,
} from "../config/chain";
import type { WalletProvider } from "./WalletProvider";
import { DevWalletProvider } from "./DevWalletProvider";
import { TurnkeyWalletProvider } from "./TurnkeyWalletProvider";

export type { WalletProvider, AnteTxRequest } from "./WalletProvider";
export { DevWalletProvider } from "./DevWalletProvider";
export { TurnkeyWalletProvider } from "./TurnkeyWalletProvider";

/**
 * Shared read-only client for log/state queries (no wallet needed). Built from
 * the supplied runtime config; defaults to the env-derived config so existing
 * call sites keep working.
 */
export function makePublicClient(
  config: AnteConfig = defaultAnteConfig
): PublicClient {
  return createPublicClient({
    chain: makeChain(config),
    transport: http(config.rpcUrl || undefined),
  });
}

/**
 * Selects a wallet implementation behind the single WalletProvider seam.
 *
 * Preference order:
 *   1. Turnkey passkey path, if the config carries a complete `turnkey` block.
 *   2. Dev local-account fallback, if `devPrivateKey` is present.
 *
 * Returns null when neither is configured — the UI then prompts the user to
 * set up a wallet rather than crashing.
 */
export function selectWalletProvider(
  config: AnteConfig = defaultAnteConfig
): WalletProvider | null {
  return (
    TurnkeyWalletProvider.fromConfig(config) ??
    DevWalletProvider.fromConfig(config) ??
    null
  );
}
