import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  encodeFunctionData,
  formatUnits,
  parseAbiItem,
  parseUnits,
  type Address,
  type Hash,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { erc20Abi } from "../abi/erc20";
import { anteAbi } from "../abi/ante";
import {
  isConfigured,
  ZERO_TOPIC,
  type AnteConfig,
} from "../config/chain";
import { useAnteConfig } from "../config/AnteProvider";
import {
  makePublicClient,
  selectWalletProvider,
  type WalletProvider,
} from "../wallet";
import {
  loadFeedCache,
  saveFeedCache,
  clearFeedCache,
  type SerializedComment,
} from "../cache/feedCache";

// --- Domain types ----------------------------------------------------------

// Mirrors the on-chain Status enum: { Active=0, Withdrawn=1, Slashed=2,
// Challenged=3 }. "Challenged" means a staked flag is open awaiting a
// moderator's resolution; the author cannot withdraw while challenged.
export type CommentStatus =
  | "Active"
  | "Withdrawn"
  | "Slashed"
  | "Challenged";

/** Details of an open (or last-resolved) challenge against a comment. */
export interface ChallengeInfo {
  flagger: Address;
  /** flagger's bond in the token's smallest unit. */
  bond: bigint;
  /** true while awaiting moderator resolution. */
  open: boolean;
}

export interface AnteComment {
  id: bigint;
  author: Address;
  content: string;
  contentHash: `0x${string}`;
  /** stake in the token's smallest unit. */
  stake: bigint;
  /** cumulative tips in the token's smallest unit. */
  tips: bigint;
  postedAt: number; // unix seconds
  status: CommentStatus;
  /** present iff there is (or was) a challenge; `open` distinguishes live. */
  challenge?: ChallengeInfo;
}

export interface TokenMeta {
  decimals: number;
  symbol: string;
}

// --- Event signatures (parsed from the SPEC; matches src/abi/Ante.json) -----

// NOTE: `topic` is the per-thread scope (keccak of a blog-post slug) and is
// indexed, so we can filter Posted logs RPC-side by topic. The other five
// streams are keyed by id and need no per-topic filter — applyBatch ignores ids
// not already in the map, so per-thread isolation falls out for free.
const postedEvent = parseAbiItem(
  "event Posted(uint256 indexed id, bytes32 indexed topic, address indexed author, bytes32 contentHash, string content, uint256 stake, uint64 postedAt)"
);
const withdrawnEvent = parseAbiItem(
  "event Withdrawn(uint256 indexed id, address indexed author, uint256 stake)"
);
const slashedEvent = parseAbiItem(
  "event Slashed(uint256 indexed id, address indexed author, uint256 stake, string reason)"
);
const tippedEvent = parseAbiItem(
  "event Tipped(uint256 indexed id, address indexed from, address indexed author, uint256 amount, uint256 fee)"
);
const flaggedEvent = parseAbiItem(
  "event Flagged(uint256 indexed id, address indexed flagger, uint256 bond, string reason)"
);
const flagResolvedEvent = parseAbiItem(
  "event FlagResolved(uint256 indexed id, address indexed flagger, bool upheld, uint256 bounty, string reason)"
);

// uint256 max — used as the approve amount for an "infinite" allowance so the
// user only ever signs one approve per token. Tradeoff noted in the SPEC's
// approve→post UX; we still skip approve entirely when allowance is sufficient.
const MAX_UINT256 = (1n << 256n) - 1n;

// --- Incremental sync config ------------------------------------------------

// Default max block span per getLogs call. Public RPCs cap eth_getLogs ranges;
// we paginate the (usually large, one-time) cold scan into windows of this
// size. Overridable per-config via `logRange` (VITE_LOG_RANGE).
const DEFAULT_LOG_RANGE = 9000n;

/**
 * Cache key — scoped to chain + contract + topic so a redeploy/switch/thread
 * never reads stale state and different per-post threads cache to separate
 * IndexedDB entries. The folded feed and last-synced block are persisted so a
 * returning visitor fetches only the delta instead of rescanning from genesis.
 */
function cacheKeyFor(config: AnteConfig): string {
  const topic = config.topic ?? ZERO_TOPIC;
  return `${config.chainId}:${config.anteAddress.toLowerCase()}:${topic.toLowerCase()}`;
}

// --- Hook ------------------------------------------------------------------

export interface UseAnte {
  comments: AnteComment[];
  token: TokenMeta | null;
  minStake: bigint | null;
  /** minimum bond (smallest units) required to challenge a comment. */
  minFlagBond: bigint | null;
  /** share of a slashed stake paid to an upholding flagger, in basis points. */
  flagBountyBps: number | null;
  challengeWindow: number | null; // seconds
  /** true when the connected wallet may resolve challenges (see hook docs). */
  isModerator: boolean;
  address: Address | null;
  walletKind: WalletProvider["kind"] | null;
  loading: boolean;
  error: string | null;
  configured: boolean;
  /** format a smallest-unit amount to a human string using token decimals. */
  format: (amount: bigint) => string;
  /** parse a human string to smallest units using token decimals. */
  parse: (amount: string) => bigint;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Clear the local cache and re-scan the feed from the deploy block. */
  rebuild: () => Promise<void>;
  post: (content: string, humanStake: string) => Promise<Hash>;
  withdraw: (id: bigint) => Promise<Hash>;
  tip: (id: bigint, humanAmount: string) => Promise<Hash>;
  /** Stake `humanBond` of the token to challenge a comment (approve→flag). */
  flag: (id: bigint, humanBond: string, reason: string) => Promise<Hash>;
  /** Moderator-only: resolve an open challenge. `uphold` slashes the comment. */
  resolveFlag: (id: bigint, uphold: boolean, reason: string) => Promise<Hash>;
}

/**
 * @param override optional partial config; merged over the active AnteConfig
 *        (from `<AnteProvider>` or env defaults). Used mainly to inject a
 *        per-post `topic` directly without a provider.
 */
export function useAnte(override?: Partial<AnteConfig>): UseAnte {
  const ctxConfig = useAnteConfig();
  const config = useMemo<AnteConfig>(
    () => (override ? { ...ctxConfig, ...override } : ctxConfig),
    [ctxConfig, override]
  );

  // Pull the config values the hook closes over. Stored in refs-free locals;
  // every callback below lists `config` (or these) in its deps.
  const anteAddress = config.anteAddress;
  const tokenAddress = config.tokenAddress;
  const topic = config.topic ?? ZERO_TOPIC;
  const configured = isConfigured(config);
  const cacheKey = useMemo(() => cacheKeyFor(config), [config]);
  const deployBlock = config.deployBlock ?? 0n;
  const logRange = config.logRange ?? DEFAULT_LOG_RANGE;
  const moderatorOverride = config.isModerator === true;

  const publicClientRef = useRef<PublicClient | null>(null);
  const walletRef = useRef<WalletProvider | null>(null);

  // In-session authoritative feed state: the folded comment map + the highest
  // block already synced. Hydrated from IndexedDB on first sync, then advanced
  // incrementally. `syncChainRef` serializes overlapping syncs so an after-write
  // refresh always sees a freshly-fetched head.
  const feedStateRef = useRef<{ byId: Map<string, AnteComment>; lastBlock: bigint } | null>(null);
  const syncChainRef = useRef<Promise<void> | null>(null);

  const [comments, setComments] = useState<AnteComment[]>([]);
  const [token, setToken] = useState<TokenMeta | null>(null);
  const [minStake, setMinStake] = useState<bigint | null>(null);
  const [minFlagBond, setMinFlagBond] = useState<bigint | null>(null);
  const [flagBountyBps, setFlagBountyBps] = useState<number | null>(null);
  const [challengeWindow, setChallengeWindow] = useState<number | null>(null);
  const [address, setAddress] = useState<Address | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [walletKind, setWalletKind] =
    useState<WalletProvider["kind"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rebuild the cached singletons whenever the active config changes (e.g. a
  // different RPC/contract/topic). Feed state is also reset so we don't fold a
  // new thread's logs onto a stale map.
  useEffect(() => {
    publicClientRef.current = null;
    walletRef.current = null;
    feedStateRef.current = null;
  }, [config]);

  // Lazily create the singletons.
  const getPublicClient = useCallback((): PublicClient => {
    if (!publicClientRef.current) {
      publicClientRef.current = makePublicClient(config);
    }
    return publicClientRef.current;
  }, [config]);

  const getWallet = useCallback((): WalletProvider => {
    if (!walletRef.current) {
      const w = selectWalletProvider(config);
      if (!w) {
        throw new Error(
          "No wallet configured. Set a dev private key (testnet) or the Turnkey config."
        );
      }
      walletRef.current = w;
    }
    return walletRef.current;
  }, [config]);

  // --- Formatting helpers --------------------------------------------------

  const decimals = token?.decimals ?? 18;
  const format = useCallback(
    (amount: bigint) => formatUnits(amount, decimals),
    [decimals]
  );
  const parse = useCallback(
    (amount: string) => parseUnits(amount || "0", decimals),
    [decimals]
  );

  // --- Reads ---------------------------------------------------------------

  /** Fetch token decimals/symbol + contract params. Never throws — sets error. */
  const loadMeta = useCallback(async () => {
    const pc = getPublicClient();
    try {
      const [dec, sym] = await Promise.all([
        pc.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "decimals",
        }),
        pc.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "symbol",
        }),
      ]);
      setToken({ decimals: Number(dec), symbol: sym as string });
    } catch {
      // Token not reachable (placeholder address / no RPC). Leave token null;
      // the UI falls back to 18-decimals formatting and shows the config banner.
      setToken(null);
    }

    try {
      const [ms, mfb, fbBps, cw] = await Promise.all([
        pc.readContract({
          address: anteAddress,
          abi: anteAbi,
          functionName: "minStake",
        }),
        pc.readContract({
          address: anteAddress,
          abi: anteAbi,
          functionName: "minFlagBond",
        }),
        pc.readContract({
          address: anteAddress,
          abi: anteAbi,
          functionName: "flagBountyBps",
        }),
        pc.readContract({
          address: anteAddress,
          abi: anteAbi,
          functionName: "challengeWindow",
        }),
      ]);
      setMinStake(ms as bigint);
      setMinFlagBond(mfb as bigint);
      setFlagBountyBps(Number(fbBps as bigint));
      setChallengeWindow(Number(cw as bigint));
    } catch {
      setMinStake(null);
      setMinFlagBond(null);
      setFlagBountyBps(null);
      setChallengeWindow(null);
    }
  }, [getPublicClient, tokenAddress, anteAddress]);

  /**
   * Incremental feed sync. Hydrates the folded feed from the IndexedDB cache on
   * first run, then fetches only logs newer than the last-synced block (chunked
   * into logRange windows to respect RPC eth_getLogs limits), folds them onto
   * the cached state, renders, and persists. Overlapping calls are serialized so
   * an after-write refresh always observes a freshly-fetched head.
   *
   * Per-post threading: the Posted stream is filtered RPC-side by `topic`, so a
   * thread only ever sees its own comments. The id-keyed status/tip streams stay
   * unfiltered — applyBatch ignores ids absent from the map, so the isolation
   * carries through for free.
   *
   * The chain is the source of truth; the cache is a rebuildable read model.
   * Folding stays correct incrementally because tips are additive and status
   * events are applied in (block, logIndex) order on top of prior state.
   */
  const loadComments = useCallback(async () => {
    const run = async () => {
      const pc = getPublicClient();

      // Hydrate in-session state from cache once per mount.
      if (!feedStateRef.current) {
        const cached = await loadFeedCache(cacheKey);
        if (cached) {
          const byId = new Map<string, AnteComment>();
          for (const s of cached.comments) byId.set(s.id, deserializeComment(s));
          feedStateRef.current = { byId, lastBlock: BigInt(cached.lastBlock) };
        } else {
          feedStateRef.current = {
            byId: new Map(),
            lastBlock: deployBlock > 0n ? deployBlock - 1n : -1n,
          };
        }
      }
      const state = feedStateRef.current;

      const head = await pc.getBlockNumber();
      let from = state.lastBlock < 0n ? 0n : state.lastBlock + 1n;

      // Fetch and fold only the delta, in bounded windows.
      while (from <= head) {
        const to = from + logRange - 1n < head ? from + logRange - 1n : head;
        const batch = await fetchEventBatch(pc, anteAddress, topic, from, to);
        applyBatch(state.byId, batch);
        from = to + 1n;
      }
      state.lastBlock = head;

      const list = toSortedList(state.byId);
      setComments(list);
      void saveFeedCache(cacheKey, {
        lastBlock: head.toString(),
        comments: list.map(serializeComment),
      });
    };

    // Serialize syncs so callers (initial load, live events, after-write
    // refresh) never interleave fetches against the same mutable state.
    const prev = syncChainRef.current ?? Promise.resolve();
    const next = prev.catch(() => {}).then(run);
    syncChainRef.current = next;
    try {
      await next;
    } finally {
      if (syncChainRef.current === next) syncChainRef.current = null;
    }
  }, [getPublicClient, cacheKey, deployBlock, logRange, anteAddress, topic]);

  // Clear the local cache and re-scan from the deploy block (recovery hatch for
  // a deep reorg or a corrupted cache).
  const rebuild = useCallback(async () => {
    await clearFeedCache(cacheKey);
    feedStateRef.current = null;
    await loadComments();
  }, [loadComments, cacheKey]);

  const refresh = useCallback(async () => {
    if (!configured) {
      setError(
        "Chain not configured. Supply rpcUrl, chainId, anteAddress, tokenAddress (env VITE_* or the embed's HTML attributes)."
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await loadMeta();
      await loadComments();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [configured, loadMeta, loadComments]);

  // When the dev/test override is set, surface the moderator panel even before
  // the user connects a wallet.
  useEffect(() => {
    if (moderatorOverride) setIsModerator(true);
  }, [moderatorOverride]);

  // Initial load + live subscription. Watch ALL Ante events (not just Posted)
  // so others' tips / flags / resolutions also stream in; each notification
  // triggers a cheap incremental sync of just the new blocks.
  useEffect(() => {
    void refresh();
    if (!configured) return;
    const pc = getPublicClient();
    const unwatch = pc.watchEvent({
      address: anteAddress,
      onLogs: () => {
        void loadComments();
      },
    });
    return () => {
      unwatch();
    };
  }, [refresh, loadComments, getPublicClient, configured, anteAddress]);

  // --- Connect -------------------------------------------------------------

  // Reads the on-chain `moderators(addr)` mapping. An explicit isModerator
  // config override (VITE_IS_MODERATOR / `is-moderator` attribute) forces the
  // panel on even when the mapping read is unavailable (e.g. placeholder
  // contract during local dev).
  const refreshModerator = useCallback(
    async (addr: Address | null) => {
      if (!addr) {
        setIsModerator(moderatorOverride);
        return;
      }
      if (moderatorOverride) {
        setIsModerator(true);
        return;
      }
      try {
        const allowed = (await getPublicClient().readContract({
          address: anteAddress,
          abi: anteAbi,
          functionName: "moderators",
          args: [addr],
        })) as boolean;
        setIsModerator(Boolean(allowed));
      } catch {
        // Mapping not reachable (placeholder address / no RPC). Fall back to
        // the override only.
        setIsModerator(moderatorOverride);
      }
    },
    [getPublicClient, moderatorOverride, anteAddress]
  );

  const connect = useCallback(async () => {
    setError(null);
    try {
      const w = getWallet();
      const addr = await w.connect();
      setAddress(addr);
      setWalletKind(w.kind);
      void refreshModerator(addr);
    } catch (e) {
      setError(errMsg(e));
      throw e;
    }
  }, [getWallet, refreshModerator]);

  // --- ERC-20 approve handling --------------------------------------------

  /**
   * Ensures the Ante contract has at least `needed` allowance from the owner,
   * approving (max) only when the current allowance is insufficient. Returns
   * after the approve tx confirms; no-op when allowance already covers `needed`.
   */
  const ensureAllowance = useCallback(
    async (owner: Address, needed: bigint) => {
      if (needed === 0n) return;
      const pc = getPublicClient();
      const current = (await pc.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, anteAddress],
      })) as bigint;
      if (current >= needed) return; // skip approve — already sufficient

      const w = getWallet();
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [anteAddress, MAX_UINT256],
      });
      const hash = await w.signAndSend({ to: tokenAddress, data });
      await pc.waitForTransactionReceipt({ hash });
    },
    [getPublicClient, getWallet, tokenAddress, anteAddress]
  );

  // --- Writes --------------------------------------------------------------

  const post = useCallback(
    async (content: string, humanStake: string): Promise<Hash> => {
      const w = getWallet();
      const owner = w.getAddress() ?? (await w.connect());
      setAddress(owner);
      setWalletKind(w.kind);
      void refreshModerator(owner);
      const stake = parse(humanStake);
      await ensureAllowance(owner, stake);
      const data = encodeFunctionData({
        abi: anteAbi,
        functionName: "post",
        // post(bytes32 topic, uint256 stake, string content) — topic scopes the
        // comment to this thread (ZERO_TOPIC = global feed when none supplied).
        args: [topic, stake, content],
      });
      const hash = await w.signAndSend({ to: anteAddress, data });
      await getPublicClient().waitForTransactionReceipt({ hash });
      await loadComments();
      return hash;
    },
    [
      getWallet,
      parse,
      ensureAllowance,
      getPublicClient,
      loadComments,
      refreshModerator,
      anteAddress,
      topic,
    ]
  );

  const withdraw = useCallback(
    async (id: bigint): Promise<Hash> => {
      const w = getWallet();
      if (!w.getAddress()) await w.connect();
      const data = encodeFunctionData({
        abi: anteAbi,
        functionName: "withdraw",
        args: [id],
      });
      const hash = await w.signAndSend({ to: anteAddress, data });
      await getPublicClient().waitForTransactionReceipt({ hash });
      await loadComments();
      return hash;
    },
    [getWallet, getPublicClient, loadComments, anteAddress]
  );

  const tip = useCallback(
    async (id: bigint, humanAmount: string): Promise<Hash> => {
      const w = getWallet();
      const owner = w.getAddress() ?? (await w.connect());
      setAddress(owner);
      setWalletKind(w.kind);
      void refreshModerator(owner);
      const amount = parse(humanAmount);
      if (amount <= 0n) throw new Error("Tip amount must be greater than zero.");
      await ensureAllowance(owner, amount);
      const data = encodeFunctionData({
        abi: anteAbi,
        functionName: "tip",
        args: [id, amount],
      });
      const hash = await w.signAndSend({ to: anteAddress, data });
      await getPublicClient().waitForTransactionReceipt({ hash });
      await loadComments();
      return hash;
    },
    [
      getWallet,
      parse,
      ensureAllowance,
      getPublicClient,
      loadComments,
      refreshModerator,
      anteAddress,
    ]
  );

  const flag = useCallback(
    async (id: bigint, humanBond: string, reason: string): Promise<Hash> => {
      const w = getWallet();
      const owner = w.getAddress() ?? (await w.connect());
      setAddress(owner);
      setWalletKind(w.kind);
      void refreshModerator(owner);
      // Flagging is now staked: bond the token like post(), so approve first.
      const bond = parse(humanBond);
      if (bond <= 0n) throw new Error("Flag bond must be greater than zero.");
      await ensureAllowance(owner, bond);
      const data = encodeFunctionData({
        abi: anteAbi,
        functionName: "flag",
        args: [id, bond, reason],
      });
      const hash = await w.signAndSend({ to: anteAddress, data });
      await getPublicClient().waitForTransactionReceipt({ hash });
      await loadComments();
      return hash;
    },
    [
      getWallet,
      parse,
      ensureAllowance,
      getPublicClient,
      loadComments,
      refreshModerator,
      anteAddress,
    ]
  );

  const resolveFlag = useCallback(
    async (id: bigint, uphold: boolean, reason: string): Promise<Hash> => {
      const w = getWallet();
      const owner = w.getAddress() ?? (await w.connect());
      setAddress(owner);
      setWalletKind(w.kind);
      void refreshModerator(owner);
      // Moderator-only on-chain; the wallet must be a moderator or this reverts.
      const data = encodeFunctionData({
        abi: anteAbi,
        functionName: "resolveFlag",
        args: [id, uphold, reason],
      });
      const hash = await w.signAndSend({ to: anteAddress, data });
      await getPublicClient().waitForTransactionReceipt({ hash });
      await loadComments();
      return hash;
    },
    [getWallet, getPublicClient, loadComments, refreshModerator, anteAddress]
  );

  return useMemo(
    () => ({
      comments,
      token,
      minStake,
      minFlagBond,
      flagBountyBps,
      challengeWindow,
      isModerator,
      address,
      walletKind,
      loading,
      error,
      configured,
      format,
      parse,
      connect,
      refresh,
      rebuild,
      post,
      withdraw,
      tip,
      flag,
      resolveFlag,
    }),
    [
      comments,
      token,
      minStake,
      minFlagBond,
      flagBountyBps,
      challengeWindow,
      isModerator,
      address,
      walletKind,
      loading,
      error,
      configured,
      format,
      parse,
      connect,
      refresh,
      rebuild,
      post,
      withdraw,
      tip,
      flag,
      resolveFlag,
    ]
  );
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// --- Incremental fold helpers (module-level, pure) -------------------------

interface EventBatch {
  posted: Log<bigint, number, false, typeof postedEvent>[];
  withdrawn: Log<bigint, number, false, typeof withdrawnEvent>[];
  slashed: Log<bigint, number, false, typeof slashedEvent>[];
  tipped: Log<bigint, number, false, typeof tippedEvent>[];
  flagged: Log<bigint, number, false, typeof flaggedEvent>[];
  flagResolved: Log<bigint, number, false, typeof flagResolvedEvent>[];
}

/**
 * Fetch all six Ante event streams for a single [fromBlock, toBlock] window.
 *
 * The Posted stream is filtered RPC-side by `topic` whenever a non-zero topic is
 * supplied (per-post threading) — viem encodes the indexed `topic` arg into the
 * eth_getLogs `topics` filter. The other five streams are id-keyed and left
 * unfiltered; applyBatch ignores ids not already in the map, so per-thread
 * isolation falls out for free. When `topic` is ZERO_TOPIC (standalone demo /
 * global feed) we don't filter Posted either.
 */
async function fetchEventBatch(
  pc: PublicClient,
  anteAddress: Address,
  topic: Hex,
  fromBlock: bigint,
  toBlock: bigint
): Promise<EventBatch> {
  const postedQuery =
    topic === ZERO_TOPIC
      ? pc.getLogs({ address: anteAddress, event: postedEvent, fromBlock, toBlock })
      : pc.getLogs({
          address: anteAddress,
          event: postedEvent,
          args: { topic },
          fromBlock,
          toBlock,
        });
  const [posted, withdrawn, slashed, tipped, flagged, flagResolved] = await Promise.all([
    postedQuery,
    pc.getLogs({ address: anteAddress, event: withdrawnEvent, fromBlock, toBlock }),
    pc.getLogs({ address: anteAddress, event: slashedEvent, fromBlock, toBlock }),
    pc.getLogs({ address: anteAddress, event: tippedEvent, fromBlock, toBlock }),
    pc.getLogs({ address: anteAddress, event: flaggedEvent, fromBlock, toBlock }),
    pc.getLogs({ address: anteAddress, event: flagResolvedEvent, fromBlock, toBlock }),
  ]);
  return { posted, withdrawn, slashed, tipped, flagged, flagResolved } as EventBatch;
}

/**
 * Fold a batch of logs onto an existing comment map (mutates in place).
 * Posts create entries; tips accumulate; status transitions
 * (Withdrawn / Slashed / Flagged→Challenged / FlagResolved) are applied in
 * (block, logIndex) order so the last one wins — correct incrementally because
 * the map already reflects all earlier-block transitions.
 */
function applyBatch(byId: Map<string, AnteComment>, b: EventBatch): void {
  for (const log of b.posted) {
    const a = log.args;
    if (a.id === undefined) continue;
    const key = a.id.toString();
    if (!byId.has(key)) {
      byId.set(key, {
        id: a.id,
        author: a.author as Address,
        content: a.content ?? "",
        contentHash: (a.contentHash ?? "0x") as `0x${string}`,
        stake: a.stake ?? 0n,
        tips: 0n,
        postedAt: Number(a.postedAt ?? 0n),
        status: "Active",
      });
    }
  }

  // Tips accumulate regardless of status; order within the batch is irrelevant.
  for (const log of b.tipped) {
    const a = log.args;
    if (a.id === undefined) continue;
    const c = byId.get(a.id.toString());
    if (c) c.tips += a.amount ?? 0n;
  }

  type Tagged =
    | { kind: "withdrawn"; log: Log<bigint, number, false, typeof withdrawnEvent> }
    | { kind: "slashed"; log: Log<bigint, number, false, typeof slashedEvent> }
    | { kind: "flagged"; log: Log<bigint, number, false, typeof flaggedEvent> }
    | { kind: "flagResolved"; log: Log<bigint, number, false, typeof flagResolvedEvent> };

  const events: Tagged[] = [
    ...b.withdrawn.map((log) => ({ kind: "withdrawn", log } as Tagged)),
    ...b.slashed.map((log) => ({ kind: "slashed", log } as Tagged)),
    ...b.flagged.map((log) => ({ kind: "flagged", log } as Tagged)),
    ...b.flagResolved.map((log) => ({ kind: "flagResolved", log } as Tagged)),
  ];

  events.sort((x, y) => {
    const bx = x.log.blockNumber ?? 0n;
    const by = y.log.blockNumber ?? 0n;
    if (bx !== by) return bx < by ? -1 : 1;
    return (x.log.logIndex ?? 0) - (y.log.logIndex ?? 0);
  });

  for (const ev of events) {
    const id = ev.log.args.id;
    if (id === undefined) continue;
    const c = byId.get(id.toString());
    if (!c) continue;
    switch (ev.kind) {
      case "withdrawn":
        c.status = "Withdrawn";
        break;
      case "slashed":
        c.status = "Slashed";
        break;
      case "flagged": {
        const a = ev.log.args;
        c.status = "Challenged";
        c.challenge = { flagger: a.flagger as Address, bond: a.bond ?? 0n, open: true };
        break;
      }
      case "flagResolved": {
        if (c.challenge) c.challenge = { ...c.challenge, open: false };
        if (!ev.log.args.upheld && c.status === "Challenged") c.status = "Active";
        break;
      }
    }
  }
}

/** Snapshot the map to a newest-first array of fresh objects (stable React identity). */
function toSortedList(byId: Map<string, AnteComment>): AnteComment[] {
  return Array.from(byId.values())
    .map((c) => ({ ...c, challenge: c.challenge ? { ...c.challenge } : undefined }))
    .sort((x, y) => (y.id > x.id ? 1 : y.id < x.id ? -1 : 0));
}

function serializeComment(c: AnteComment): SerializedComment {
  return {
    id: c.id.toString(),
    author: c.author,
    content: c.content,
    contentHash: c.contentHash,
    stake: c.stake.toString(),
    tips: c.tips.toString(),
    postedAt: c.postedAt,
    status: c.status,
    challenge: c.challenge
      ? { flagger: c.challenge.flagger, bond: c.challenge.bond.toString(), open: c.challenge.open }
      : undefined,
  };
}

function deserializeComment(s: SerializedComment): AnteComment {
  return {
    id: BigInt(s.id),
    author: s.author as Address,
    content: s.content,
    contentHash: s.contentHash as `0x${string}`,
    stake: BigInt(s.stake),
    tips: BigInt(s.tips),
    postedAt: s.postedAt,
    status: s.status as CommentStatus,
    challenge: s.challenge
      ? { flagger: s.challenge.flagger as Address, bond: BigInt(s.challenge.bond), open: s.challenge.open }
      : undefined,
  };
}
