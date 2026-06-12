import type { Account, Address, Hash, WalletClient, PublicClient } from "viem";

/**
 * Transaction request the widget hands to the wallet. We keep this minimal and
 * viem-shaped: a contract call is encoded by the caller into `to` + `data`.
 * `value` is optional (Tempo uses stablecoin gas; most Ante calls are value-0).
 */
export interface AnteTxRequest {
  to: Address;
  data: `0x${string}`;
  value?: bigint;
}

/**
 * The single seam every wallet implementation honors. The widget and the
 * useAnte hook only ever depend on this interface — never on Turnkey or viem
 * local-account specifics.
 */
export interface WalletProvider {
  /** Human label for the active backend, e.g. "Dev key" or "Passkey". */
  readonly kind: "dev" | "turnkey";

  /**
   * Establish the wallet session. For the dev key this is synchronous-ish
   * (derives the account); for Turnkey this triggers the passkey / WebAuthn
   * prompt and provisions an embedded wallet. Idempotent.
   */
  connect(): Promise<Address>;

  /** The active address, or null before connect(). */
  getAddress(): Address | null;

  /**
   * Sign and broadcast a transaction, returning the tx hash. Throws if not
   * connected. The implementation owns chain/gas wiring via its WalletClient.
   */
  signAndSend(tx: AnteTxRequest): Promise<Hash>;

  /**
   * A viem WalletClient bound to the active account, for callers that prefer
   * viem's typed `writeContract`. Null before connect(). Both this and
   * signAndSend() route through the same underlying signer.
   */
  getWalletClient(): WalletClient | null;
}

/** Shared dependency: a read-only public client for log/state queries. */
export interface WalletDeps {
  publicClient: PublicClient;
}

/** Narrowing helper used by implementations that hold a viem Account. */
export type LocalSigner = Account;
