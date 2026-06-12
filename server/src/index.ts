import express, { type Request, type Response } from "express";
import cors from "cors";
import {
  makeTurnkey,
  createUserWallet,
  type CreateWalletInput,
  type PasskeyAttestation,
} from "./turnkey.js";

/**
 * Ante backend — minimal. One job: turn a browser passkey registration into a
 * Turnkey sub-organization + wallet, keeping the parent-org API key off the
 * client. Everything else (reading the comment feed, sending txs) happens
 * client-side against Tempo directly; this server never sees a stake or a tip.
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "http://localhost:5173";

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(cors({ origin: ALLOWED_ORIGIN }));

// Lazily construct the Turnkey client so the server can boot (and answer
// /healthz) even before creds are wired, failing only on the wallet route.
let turnkeyClient: ReturnType<typeof makeTurnkey> | null = null;
function getTurnkey() {
  if (!turnkeyClient) {
    turnkeyClient = makeTurnkey({
      apiBaseUrl: requireEnv("TURNKEY_API_BASE_URL"),
      apiPublicKey: requireEnv("TURNKEY_API_PUBLIC_KEY"),
      apiPrivateKey: requireEnv("TURNKEY_API_PRIVATE_KEY"),
      organizationId: requireEnv("TURNKEY_ORGANIZATION_ID"),
    });
  }
  return turnkeyClient;
}

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "ante-server" });
});

/**
 * POST /api/wallet
 * Body: { userName: string, challenge: string, attestation: PasskeyAttestation }
 * Returns: { subOrganizationId, walletId, address }
 */
app.post("/api/wallet", async (req: Request, res: Response) => {
  try {
    const { userName, challenge, attestation } = req.body as Partial<CreateWalletInput>;
    if (
      typeof userName !== "string" ||
      typeof challenge !== "string" ||
      !attestation ||
      typeof (attestation as PasskeyAttestation).credentialId !== "string"
    ) {
      return res.status(400).json({ error: "userName, challenge, and attestation are required" });
    }

    const result = await createUserWallet(getTurnkey(), {
      userName,
      challenge,
      attestation: attestation as PasskeyAttestation,
    });
    return res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    // Don't leak internals; log server-side, return a generic-ish message.
    console.error("[/api/wallet] failed:", message);
    return res.status(502).json({ error: "wallet creation failed", detail: message });
  }
});

app.listen(PORT, () => {
  console.log(`ante-server listening on :${PORT} (allowed origin: ${ALLOWED_ORIGIN})`);
});
