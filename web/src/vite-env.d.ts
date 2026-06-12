/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_ANTE_ADDRESS?: string;
  readonly VITE_TOKEN_ADDRESS?: string;
  readonly VITE_CHAIN_ID?: string;
  /** dev-only fallback: a 0x-prefixed private key for a testnet viem local account. */
  readonly VITE_DEV_PRIVATE_KEY?: string;
  /** Turnkey embedded-wallet config (optional; passkey path). */
  readonly VITE_TURNKEY_ORGANIZATION_ID?: string;
  readonly VITE_TURNKEY_API_BASE_URL?: string;
  readonly VITE_TURNKEY_RP_ID?: string;
  /** Address of the Turnkey wallet account (the signing address) once provisioned. */
  readonly VITE_TURNKEY_SIGN_WITH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
