import { Turnkey } from "@turnkey/sdk-server";

/**
 * Server-side Turnkey wrapper for Ante.
 *
 * The parent-organization API key (TURNKEY_API_PRIVATE_KEY) MUST stay on the
 * server — it can create sub-organizations and must never reach the browser.
 * The browser does the passkey/WebAuthn registration and hands us the
 * resulting `challenge` + `attestation`; we create a Turnkey sub-organization
 * whose sole root user authenticates with that passkey, plus a wallet. The
 * user's key material lives in Turnkey's secure enclave — neither Ante nor the
 * user ever handles a seed phrase.
 *
 * Tempo is EVM-compatible, so a standard Ethereum account (m/44'/60'/0'/0/0)
 * produces an address usable directly on Tempo — no chain-specific wallet
 * config is required here.
 */

export interface TurnkeyConfig {
  apiBaseUrl: string;
  apiPublicKey: string;
  apiPrivateKey: string;
  organizationId: string;
}

/** Passkey registration material produced by the browser (WebAuthn). */
export interface PasskeyAttestation {
  credentialId: string;
  clientDataJson: string;
  attestationObject: string;
  transports: string[];
}

export interface CreateWalletInput {
  /** Display name for the user / sub-org (not PII-sensitive; pseudonymous). */
  userName: string;
  /** The WebAuthn challenge the browser signed during registration. */
  challenge: string;
  attestation: PasskeyAttestation;
}

export interface CreateWalletResult {
  subOrganizationId: string;
  walletId: string;
  /** EVM address, usable on Tempo. */
  address: string;
}

const ETHEREUM_ACCOUNT = {
  curve: "CURVE_SECP256K1",
  pathFormat: "PATH_FORMAT_BIP32",
  path: "m/44'/60'/0'/0/0",
  addressFormat: "ADDRESS_FORMAT_ETHEREUM",
} as const;

export function makeTurnkey(cfg: TurnkeyConfig): Turnkey {
  return new Turnkey({
    apiBaseUrl: cfg.apiBaseUrl,
    apiPublicKey: cfg.apiPublicKey,
    apiPrivateKey: cfg.apiPrivateKey,
    defaultOrganizationId: cfg.organizationId,
  });
}

/**
 * Create a sub-organization + wallet for a new passkey user.
 *
 * NOTE(facts): the exact option keys and the shape of the response object
 * differ across @turnkey/sdk-server majors (the Tempo doc page self-flags as
 * incomplete). The call is therefore made through a narrowly-typed boundary so
 * this module compiles against any installed major; reconcile the exact field
 * names against the live `with-tempo` example before going to production:
 *   https://github.com/tkhq/sdk/tree/main/examples/with-tempo
 */
export async function createUserWallet(
  turnkey: Turnkey,
  input: CreateWalletInput,
): Promise<CreateWalletResult> {
  // The apiClient() surface is stable; the per-method request shape is the
  // part that churns, so we scope the `any` to just the request payload.
  const client = turnkey.apiClient() as unknown as {
    createSubOrganization: (req: unknown) => Promise<{
      subOrganizationId: string;
      wallet?: { walletId: string; addresses: string[] };
    }>;
  };

  const resp = await client.createSubOrganization({
    subOrganizationName: `ante:${input.userName}`,
    rootQuorumThreshold: 1,
    rootUsers: [
      {
        userName: input.userName,
        apiKeys: [],
        oauthProviders: [],
        authenticators: [
          {
            authenticatorName: "ante-passkey",
            challenge: input.challenge,
            attestation: {
              credentialId: input.attestation.credentialId,
              clientDataJson: input.attestation.clientDataJson,
              attestationObject: input.attestation.attestationObject,
              transports: input.attestation.transports,
            },
          },
        ],
      },
    ],
    wallet: {
      walletName: "Ante wallet",
      accounts: [ETHEREUM_ACCOUNT],
    },
  });

  const address = resp.wallet?.addresses?.[0];
  if (!resp.subOrganizationId || !resp.wallet?.walletId || !address) {
    throw new Error("Turnkey createSubOrganization returned an unexpected shape");
  }

  return {
    subOrganizationId: resp.subOrganizationId,
    walletId: resp.wallet.walletId,
    address,
  };
}
