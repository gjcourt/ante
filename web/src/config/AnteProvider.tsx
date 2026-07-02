import { createContext, useContext, useMemo, type ReactNode } from "react";
import { defaultAnteConfig, type AnteConfig } from "./chain";
// DIRECT path (not the barrel) so the runtime ESM cycle stays exactly two
// modules — config/AnteProvider ↔ wallet/AnteWeb3Provider — resolved because
// both reference the other ONLY inside a component body (no module-top-level
// eval), which ESM live-binding handles safely.
import { AnteWeb3Provider } from "../wallet/AnteWeb3Provider";

// ---------------------------------------------------------------------------
// AnteProvider — supplies the runtime AnteConfig via React context.
//
// The standalone app may omit it entirely (consumers fall back to the
// env-derived `defaultAnteConfig`). The embed web component wraps the widget in
// `<AnteProvider config={...}>` with config built from its HTML attributes, so
// the same component code serves both the standalone build and the embed with
// no `import.meta.env` reads at the call site.
// ---------------------------------------------------------------------------

const AnteConfigContext = createContext<AnteConfig | null>(null);

export function AnteProvider({
  config,
  children,
}: {
  config?: Partial<AnteConfig>;
  children: ReactNode;
}) {
  // Shallow-merge over the env defaults so a partial config (e.g. just topic +
  // addresses from the embed) still has every field populated.
  const merged = useMemo<AnteConfig>(
    () => ({ ...defaultAnteConfig, ...config }),
    [config]
  );
  return (
    <AnteConfigContext.Provider value={merged}>
      <AnteWeb3Provider>{children}</AnteWeb3Provider>
    </AnteConfigContext.Provider>
  );
}

/**
 * Resolve the active AnteConfig. Returns the provided config when inside an
 * `<AnteProvider>`, else the env-derived default — so `useAnte` works whether or
 * not a provider is mounted (standalone vs. embed).
 */
export function useAnteConfig(): AnteConfig {
  return useContext(AnteConfigContext) ?? defaultAnteConfig;
}
