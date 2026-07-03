import { createPublicClient, http, type PublicClient } from "viem";
import {
  defaultAnteConfig,
  makeChain,
  type AnteConfig,
} from "../config/chain";

// makePublicClient is defined in THIS file via `export function` below — a
// module cannot re-export a name from itself, so it is NOT among the re-exports.
export { DevWalletProvider, type WalletKind } from "./DevWalletProvider";
export { AnteWeb3Provider } from "./AnteWeb3Provider"; // makeWagmiConfig is module-private
export { usePasskeyWallet, type PasskeyWallet } from "./usePasskeyWallet";

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
