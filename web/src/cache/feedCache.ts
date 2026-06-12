// IndexedDB-backed cache for the reconstructed comment feed.
//
// The chain is the source of truth; this is a rebuildable read cache. We store
// the folded feed plus the highest block we've synced, so a returning visitor
// only fetches logs for the *delta* since their last visit instead of
// re-scanning history from the deploy block on every load.
//
// Keyed by chain id + contract address, so a redeploy or chain switch never
// reads stale state. All bigints are serialized to strings (JSON-safe and
// stable across browsers). Every operation fails soft: if IndexedDB is
// unavailable (SSR, private mode, quota), reads return null and writes no-op,
// and the hook falls back to a full scan.

export interface SerializedChallenge {
  flagger: string;
  bond: string;
  open: boolean;
}

export interface SerializedComment {
  id: string;
  author: string;
  content: string;
  contentHash: string;
  stake: string;
  tips: string;
  postedAt: number;
  status: string;
  challenge?: SerializedChallenge;
}

export interface FeedCacheEntry {
  /** highest block number synced into `comments`, as a decimal string. */
  lastBlock: string;
  comments: SerializedComment[];
}

const DB_NAME = "ante";
const DB_VERSION = 1;
const STORE = "feed";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadFeedCache(key: string): Promise<FeedCacheEntry | null> {
  try {
    const db = await openDb();
    try {
      return await new Promise<FeedCacheEntry | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as FeedCacheEntry | undefined) ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null; // no cache available — caller does a full scan
  }
}

export async function saveFeedCache(key: string, entry: FeedCacheEntry): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(entry, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // best-effort; a failed cache write just means a fuller scan next load
  }
}

export async function clearFeedCache(key: string): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}
