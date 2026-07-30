import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  encodeFunctionData,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import { anteAbi } from "../abi/ante";
import { useAnteConfig } from "../config/AnteProvider";
import {
  makePublicClient,
  usePasskeyWallet,
  DevWalletProvider,
  type WalletKind,
} from "../wallet";

// ---------------------------------------------------------------------------
// useAnteAdmin — the owner/moderator data layer for the admin console.
//
// Deliberately a COMPANION hook (not folded into useAnte): the embed widget only
// ever calls useAnte, so keeping the owner reads (`owner`, `treasury`,
// `tipFeeBps`) and the eight privileged writes (`slash` + the seven owner
// setters) out here keeps them out of the shipped `<ante-comments>` bundle. It
// reuses the SAME primitives useAnte does — the shared AnteConfig context, a
// makePublicClient read client, and the passkey / dev-key signer seam — so there
// is no second wallet or config source of truth.
//
// The connected `address` is passed IN (from the caller's useAnte) so `isOwner`
// is derived against the single address the rest of the UI already shows, rather
// than a divergent copy. Writes resolve their own signer from the shared wagmi
// context (passkey) or a config-derived dev wallet, identical to useAnte's seam.
// ---------------------------------------------------------------------------

/** Amounts (minStake / minFlagBond) are passed as token smallest-units — the
    caller parses human input with useAnte's decimals-aware `parse`. */
export interface UseAnteAdmin {
  owner: Address | null;
  treasury: Address | null;
  /** share of each tip routed to the treasury, in basis points. */
  tipFeeBps: number | null;
  /** true when the connected wallet is the contract owner. */
  isOwner: boolean;
  walletKind: WalletKind | null;
  loading: boolean;
  error: string | null;
  /** re-read owner/treasury/tipFeeBps from chain. */
  refresh: () => Promise<void>;
  /** read the on-chain moderator flag for an arbitrary address. */
  readModerator: (addr: Address) => Promise<boolean>;

  // --- Moderator write ---
  slash: (id: bigint, reason: string) => Promise<Hash>;

  // --- Owner writes ---
  setMinStake: (amount: bigint) => Promise<Hash>;
  setMinFlagBond: (amount: bigint) => Promise<Hash>;
  setFlagBountyBps: (bps: number) => Promise<Hash>;
  setTipFeeBps: (bps: number) => Promise<Hash>;
  setChallengeWindow: (seconds: number) => Promise<Hash>;
  setTreasury: (addr: Address) => Promise<Hash>;
  setModerator: (addr: Address, allowed: boolean) => Promise<Hash>;
}

export function useAnteAdmin(connectedAddress: Address | null): UseAnteAdmin {
  const config = useAnteConfig();
  const anteAddress = config.anteAddress;

  const publicClientRef = useRef<PublicClient | null>(null);
  const getPublicClient = useCallback((): PublicClient => {
    if (!publicClientRef.current) {
      publicClientRef.current = makePublicClient(config);
    }
    return publicClientRef.current;
  }, [config]);

  // Reset the cached client when the active config (chain/contract) changes.
  useEffect(() => {
    publicClientRef.current = null;
  }, [config]);

  const [owner, setOwner] = useState<Address | null>(null);
  const [treasury, setTreasury] = useState<Address | null>(null);
  const [tipFeeBps, setTipFeeBps] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Signer seam (mirrors useAnte) -------------------------------------
  const passkey = usePasskeyWallet();
  const devWallet = useMemo(
    () => DevWalletProvider.fromConfig(config),
    [config]
  );
  const walletKind: WalletKind | null = devWallet
    ? "dev"
    : passkey.address
      ? "passkey"
      : null;

  const signer = useMemo<{
    address: Address | undefined;
    connect: () => Promise<Address | undefined>;
    sendTx: (tx: { to: Hex; data: Hex; value?: bigint }) => Promise<Hash>;
  }>(
    () =>
      devWallet
        ? {
            address: devWallet.getAddress() ?? undefined,
            connect: async () => await devWallet.connect(),
            sendTx: (tx) => devWallet.signAndSend(tx),
          }
        : {
            address: passkey.address,
            connect: async () => {
              await passkey.connect();
              return passkey.address;
            },
            sendTx: passkey.sendTx,
          },
    [devWallet, passkey.address, passkey.connect, passkey.sendTx]
  );

  // --- Reads --------------------------------------------------------------
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const pc = getPublicClient();
    try {
      const [own, tre, tfb] = await Promise.all([
        pc.readContract({
          address: anteAddress,
          abi: anteAbi,
          functionName: "owner",
        }),
        pc.readContract({
          address: anteAddress,
          abi: anteAbi,
          functionName: "treasury",
        }),
        pc.readContract({
          address: anteAddress,
          abi: anteAbi,
          functionName: "tipFeeBps",
        }),
      ]);
      setOwner(own as Address);
      setTreasury(tre as Address);
      setTipFeeBps(Number(tfb as bigint));
    } catch {
      // Placeholder address / unreachable RPC — leave nulls; the panel shows a
      // "not configured" state rather than throwing opaque RPC errors.
      setOwner(null);
      setTreasury(null);
      setTipFeeBps(null);
    } finally {
      setLoading(false);
    }
  }, [getPublicClient, anteAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const readModerator = useCallback(
    async (addr: Address): Promise<boolean> => {
      try {
        return (await getPublicClient().readContract({
          address: anteAddress,
          abi: anteAbi,
          functionName: "moderators",
          args: [addr],
        })) as boolean;
      } catch {
        return false;
      }
    },
    [getPublicClient, anteAddress]
  );

  const isOwner = useMemo(
    () =>
      !!connectedAddress &&
      !!owner &&
      connectedAddress.toLowerCase() === owner.toLowerCase(),
    [connectedAddress, owner]
  );

  // --- Write helper -------------------------------------------------------
  // Shared preamble for every privileged write: connect if needed, send the
  // encoded call, wait for the receipt, then re-read the config values so the
  // panel reflects the new on-chain state. Follows useAnte's write pattern (and
  // its WebAuthn activation invariant: the connect()/sendTx() calls are reached
  // straight from the caller's click with no intervening awaited work of ours).
  const send = useCallback(
    async (functionName: string, args: readonly unknown[]): Promise<Hash> => {
      setError(null);
      if (!signer.address) {
        if (!(await signer.connect())) {
          throw new Error(
            "Wallet not connected. Connect your passkey and try again."
          );
        }
      }
      const data = encodeFunctionData({
        abi: anteAbi,
        functionName,
        args,
      } as Parameters<typeof encodeFunctionData>[0]);
      try {
        const hash = await signer.sendTx({ to: anteAddress, data });
        await getPublicClient().waitForTransactionReceipt({ hash });
        await refresh();
        return hash;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
    [signer, anteAddress, getPublicClient, refresh]
  );

  const slash = useCallback(
    (id: bigint, reason: string) => send("slash", [id, reason]),
    [send]
  );
  const setMinStakeW = useCallback(
    (amount: bigint) => send("setMinStake", [amount]),
    [send]
  );
  const setMinFlagBondW = useCallback(
    (amount: bigint) => send("setMinFlagBond", [amount]),
    [send]
  );
  const setFlagBountyBpsW = useCallback(
    (bps: number) => send("setFlagBountyBps", [BigInt(bps)]),
    [send]
  );
  const setTipFeeBpsW = useCallback(
    (bps: number) => send("setTipFeeBps", [BigInt(bps)]),
    [send]
  );
  const setChallengeWindowW = useCallback(
    (seconds: number) => send("setChallengeWindow", [BigInt(seconds)]),
    [send]
  );
  const setTreasuryW = useCallback(
    (addr: Address) => send("setTreasury", [addr]),
    [send]
  );
  const setModeratorW = useCallback(
    (addr: Address, allowed: boolean) => send("setModerator", [addr, allowed]),
    [send]
  );

  return useMemo(
    () => ({
      owner,
      treasury,
      tipFeeBps,
      isOwner,
      walletKind,
      loading,
      error,
      refresh,
      readModerator,
      slash,
      setMinStake: setMinStakeW,
      setMinFlagBond: setMinFlagBondW,
      setFlagBountyBps: setFlagBountyBpsW,
      setTipFeeBps: setTipFeeBpsW,
      setChallengeWindow: setChallengeWindowW,
      setTreasury: setTreasuryW,
      setModerator: setModeratorW,
    }),
    [
      owner,
      treasury,
      tipFeeBps,
      isOwner,
      walletKind,
      loading,
      error,
      refresh,
      readModerator,
      slash,
      setMinStakeW,
      setMinFlagBondW,
      setFlagBountyBpsW,
      setTipFeeBpsW,
      setChallengeWindowW,
      setTreasuryW,
      setModeratorW,
    ]
  );
}

// --- Shared validation bounds (mirror contracts/src/Ante.sol) --------------
/** basis-point denominator; bps setters must be <= this. */
export const BPS_DENOMINATOR = 10_000;
/** upper bound on challengeWindow, in seconds (30 days). */
export const MAX_CHALLENGE_WINDOW_SECS = 30 * 24 * 60 * 60;
