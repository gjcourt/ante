import {
  createWalletClient,
  http,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type WalletClient,
} from "viem";
import { makeChain, type AnteConfig } from "../config/chain";
import type { AnteTxRequest, WalletProvider } from "./WalletProvider";

/**
 * Real embedded-wallet path: Turnkey passkey (WebAuthn) signer.
 *
 * Flow (per Turnkey's embedded-wallet + @turnkey/viem docs and the Tempo
 * `with-tempo` example):
 *   1. Instantiate the browser SDK with the parent organization id + API base.
 *   2. Trigger a passkey (Face ID / Touch ID) login, yielding a sub-org client.
 *   3. Build a viem `Account` from `@turnkey/viem`'s `createAccount`, bound to
 *      the Turnkey client + the wallet's signing address (`signWith`).
 *   4. Wrap it in a viem WalletClient over the Tempo RPC and sign/send normally.
 *
 * Because the Turnkey SDK surface changes across majors and the research
 * agent's verified setup notes (docs/tempo-facts.md) are not present at build
 * time, the SDK is loaded via dynamic import and accessed through a loosely
 * typed adapter. This keeps `npm run build` green and the dev fallback fully
 * functional even if a given SDK version's exact call shape differs. Every
 * unverified call site is marked TODO(facts) and surfaced in the summary.
 */
export interface TurnkeyConfig {
  organizationId: string;
  apiBaseUrl: string;
  rpId: string;
  /** The Turnkey wallet account address to sign with (provisioned out-of-band). */
  signWith: Address;
}

export class TurnkeyWalletProvider implements WalletProvider {
  readonly kind = "turnkey" as const;

  private client: WalletClient | null = null;
  private address: Address | null = null;
  private readonly chain: Chain;
  private readonly rpcUrl: string;

  constructor(
    private readonly config: TurnkeyConfig,
    anteConfig: AnteConfig
  ) {
    this.chain = makeChain(anteConfig);
    this.rpcUrl = anteConfig.rpcUrl;
  }

  /** Returns a provider iff the runtime config carries a complete Turnkey block. */
  static fromConfig(anteConfig: AnteConfig): TurnkeyWalletProvider | null {
    const tk = anteConfig.turnkey;
    if (!tk || !tk.organizationId || !tk.apiBaseUrl || !tk.rpId || !tk.signWith) {
      return null;
    }
    return new TurnkeyWalletProvider(
      {
        organizationId: tk.organizationId,
        apiBaseUrl: tk.apiBaseUrl,
        rpId: tk.rpId,
        signWith: tk.signWith,
      },
      anteConfig
    );
  }

  async connect(): Promise<Address> {
    const account = await this.buildPasskeyAccount();
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

  async signAndSend(tx: AnteTxRequest): Promise<Hash> {
    if (!this.client || !this.client.account) {
      throw new Error(
        "TurnkeyWalletProvider not connected; call connect() first."
      );
    }
    return this.client.sendTransaction({
      account: this.client.account,
      chain: this.chain,
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
    });
  }

  /**
   * Builds a viem Account backed by a Turnkey passkey signer.
   *
   * TODO(facts): the precise constructor options and method names below depend
   * on the installed @turnkey/sdk-browser + @turnkey/viem versions and the
   * verified Tempo setup notes. Reconcile against docs/tempo-facts.md and the
   * official `with-tempo` example during integration. The shape used here
   * follows the documented passkey-login + createAccount pattern.
   */
  private async buildPasskeyAccount(): Promise<Account> {
    // Dynamic import keeps the dev-fallback bundle independent of the Turnkey
    // SDK's exact export surface.
    const sdkBrowser = (await import("@turnkey/sdk-browser")) as unknown as {
      Turnkey?: new (opts: Record<string, unknown>) => TurnkeyBrowserLike;
    };
    const viemAdapter = (await import("@turnkey/viem")) as unknown as {
      createAccount?: (opts: Record<string, unknown>) => Promise<Account>;
    };

    const TurnkeyCtor = sdkBrowser.Turnkey;
    const createAccount = viemAdapter.createAccount;
    if (!TurnkeyCtor || !createAccount) {
      throw new Error(
        "[TurnkeyWalletProvider] Turnkey SDK surface not as expected; see TODO(facts) and docs/tempo-facts.md."
      );
    }

    // 1. Instantiate the browser SDK.
    // TODO(facts): confirm option keys (apiBaseUrl / defaultOrganizationId / rpId)
    // for the pinned @turnkey/sdk-browser version.
    const turnkey = new TurnkeyCtor({
      apiBaseUrl: this.config.apiBaseUrl,
      defaultOrganizationId: this.config.organizationId,
      rpId: this.config.rpId,
    });

    // 2. Obtain a passkey-authenticated client (triggers WebAuthn prompt).
    // TODO(facts): confirm the passkey-client accessor. Common names across
    // versions: passkeyClient() / passkeySign() / getPasskeyClient().
    const passkeyClient = await turnkey.passkeyClient();

    // 3. Build a viem Account from the Turnkey client + signing address.
    // TODO(facts): confirm createAccount option keys (client / organizationId /
    // signWith) for the pinned @turnkey/viem version.
    const account = await createAccount({
      client: passkeyClient,
      organizationId: this.config.organizationId,
      signWith: this.config.signWith,
      ethereumAddress: this.config.signWith,
    });

    return account;
  }
}

/**
 * Structural type for the slice of the Turnkey browser SDK we touch. Loosely
 * typed on purpose (see TODO(facts) above); the real surface is reconciled at
 * integration time.
 */
interface TurnkeyBrowserLike {
  passkeyClient(): Promise<unknown>;
}
