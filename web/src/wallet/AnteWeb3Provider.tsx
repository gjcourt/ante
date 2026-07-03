import {
  WagmiProvider,
  createConfig,
  http,
  useReconnect,
  type Config,
} from "wagmi";
import { webAuthn } from "wagmi/tempo";
import { tempo, tempoTestnet } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { isMainnet, type AnteConfig } from "../config/chain";
import { useAnteConfig } from "../config/AnteProvider";

// ---------------------------------------------------------------------------
// AnteWeb3Provider — the runtime-configured wagmi + react-query provider, built
// INSIDE React from the current `AnteConfig` so the embed stays runtime-
// configurable via HTML attributes (chainId / rpc read at runtime). N widgets on
// a page = N Configs, each with its own in-memory connection state (§1). We do
// NOT build a shared hoist point.
// ---------------------------------------------------------------------------

/**
 * Build a wagmi `Config` from an `AnteConfig`. MODULE-PRIVATE (not exported
 * through the barrel).
 *
 * - Chain object comes from `wagmi/chains` (the official Tempo chain, which may
 *   carry Tempo extensions the connector relies on) — NOT `makeChain`, which is
 *   for the read-only publicClient + DevWallet path only. Network is selected
 *   purely by the chain object here, never by a connector flag.
 * - Only the RPC is overridden, via `transports` keyed on the chain id. The
 *   chain object's `.id` MUST equal `config.chainId` or the transport keying
 *   mismatches the chain.
 * - `connectors: [webAuthn()]` — backendless (no `authUrl`), and there is NO
 *   `testnet` option; the network is the chain object.
 * - `multiInjectedProviderDiscovery: false` so the embed never attaches to the
 *   host page's injected wallets.
 * - Default storage (no custom `key`) so all same-origin Configs share one
 *   namespace for mount-time address rehydrate.
 */
function makeWagmiConfig(config: AnteConfig): Config {
  // Only the RPC is overridden. The transport is keyed on the SELECTED chain's
  // own id (not the raw `config.chainId`) so the `transports` map satisfies the
  // `Record<chain['id'], Transport>` wagmi infers from a single-chain tuple.
  // (`config.chainId` must equal the chain's id for the RPC to bind — enforced
  // by `isMainnet` selecting the matching chain object.)
  const transport = http(config.rpcUrl || undefined);
  return isMainnet(config)
    ? createConfig({
        chains: [tempo],
        connectors: [webAuthn()],
        transports: { [tempo.id]: transport },
        multiInjectedProviderDiscovery: false,
      })
    : createConfig({
        chains: [tempoTestnet],
        connectors: [webAuthn()],
        transports: { [tempoTestnet.id]: transport },
        multiInjectedProviderDiscovery: false,
      });
}

/**
 * Fires a SILENT reconnect ONCE at mount to rehydrate a prior same-origin
 * session's address from storage WITHOUT a WebAuthn ceremony.
 *
 * We attempt exactly once via a ref guard, NOT gated on connection status. An
 * earlier status-gated version (`if (status === "disconnected") reconnect()`)
 * infinite-looped on every fresh visit: with no session to restore, reconnect()
 * bounces status disconnected → reconnecting → disconnected, which re-fired the
 * effect and called reconnect() again forever, pegging the main thread. Firing
 * once decouples us from that bounce. A StrictMode double-mount re-runs it once
 * more, which is a harmless no-op (reconnect is idempotent when nothing stored).
 *
 * Must be rendered INSIDE <WagmiProvider> (it uses wagmi hooks). No OS dialog
 * fires on mount — reconnect rehydrates the address silently.
 */
function SilentReconnect(): null {
  const { reconnect } = useReconnect();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    reconnect();
  }, [reconnect]);

  return null;
}

export function AnteWeb3Provider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const config = useAnteConfig();

  // Rebuild the wagmi Config ONLY when a transport-affecting field changes.
  // Keying on full-`config` identity would drop an in-progress connection on
  // every attribute mutation; keying only on chainId would leave a stale RPC.
  // anteAddress / tokenAddress / topic changes must NOT tear down the wallet.
  const wagmiConfig = useMemo(
    () => makeWagmiConfig(config),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.chainId, config.rpcUrl]
  );

  // One QueryClient per React root, created exactly once (never re-created on
  // re-render).
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SilentReconnect />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
