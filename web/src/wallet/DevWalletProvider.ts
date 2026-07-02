import {
  createWalletClient,
  http,
  type Address,
  type Chain,
  type Hash,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { makeChain, type AnteConfig } from "../config/chain";

/**
 * Canonical wallet-kind label for the active signing backend. Lives here (the
 * module that owns the dev kind) as the single source of truth; the passkey
 * path reports "passkey". Re-exported through `wallet/index.ts`.
 */
export type WalletKind = "dev" | "passkey";

/**
 * Dev fallback wallet: a viem local account derived from a private key in the
 * runtime config (`devPrivateKey`, seeded from `VITE_DEV_PRIVATE_KEY`). Testnet
 * only — this is the local-dev path that makes the app run end-to-end without a
 * passkey ceremony. The production path is the Tempo wagmi webAuthn connector
 * (see `usePasskeyWallet`); this is selected only when `devPrivateKey` is set.
 *
 * NEVER ship a real key this way; it is bundled into the client. Intended only
 * for a throwaway testnet account funded from the faucet.
 */
export class DevWalletProvider {
  readonly kind = "dev" as const;

  private client: WalletClient | null = null;
  private address: Address | null = null;
  private readonly chain: Chain;
  private readonly rpcUrl: string;

  constructor(
    private readonly privateKey: `0x${string}`,
    config: AnteConfig
  ) {
    this.chain = makeChain(config);
    this.rpcUrl = config.rpcUrl;
  }

  /** Returns a provider iff a well-formed dev key is present in config. */
  static fromConfig(config: AnteConfig): DevWalletProvider | null {
    const raw = config.devPrivateKey;
    if (!raw) return null;
    const key = raw.startsWith("0x") ? raw : `0x${raw}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      console.warn(
        "[DevWalletProvider] devPrivateKey is set but not a 32-byte hex key; ignoring."
      );
      return null;
    }
    return new DevWalletProvider(key as `0x${string}`, config);
  }

  async connect(): Promise<Address> {
    const account = privateKeyToAccount(this.privateKey);
    this.client = createWalletClient({
      account,
      chain: this.chain,
      transport: http(this.rpcUrl || undefined),
    });
    this.address = account.address;
    return this.address;
  }

  getAddress(): Address | null {
    return this.address;
  }

  getWalletClient(): WalletClient | null {
    return this.client;
  }

  async signAndSend(tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    value?: bigint;
  }): Promise<Hash> {
    if (!this.client || !this.client.account) {
      throw new Error("DevWalletProvider not connected; call connect() first.");
    }
    return this.client.sendTransaction({
      account: this.client.account,
      chain: this.chain,
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
    });
  }
}
