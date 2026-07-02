import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useAnte, type AnteComment, type CommentStatus } from "../hooks/useAnte";
import type { WalletKind } from "../wallet";
import "./AnteComments.css";

// ---------------------------------------------------------------------------
// Ante widget: pseudonymous pay-to-comment with stake-and-slash. Self-contained
// — drop <AnteComments /> anywhere. All chain/wallet wiring lives in useAnte.
// ---------------------------------------------------------------------------

export function AnteComments() {
  const ante = useAnte();
  const {
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
    connect,
  } = ante;

  const symbol = token?.symbol ?? "tokens";
  const minStakeHuman = minStake != null ? format(minStake) : null;
  const minFlagBondHuman = minFlagBond != null ? format(minFlagBond) : null;

  return (
    <section className="ante">
      <header className="ante__head">
        <div>
          <h2 className="ante__title">Comments</h2>
          <p className="ante__tagline">
            Stake {symbol} to comment. Your stake comes back unless your comment
            is challenged and removed. Challenging also stakes a bond — refunded
            with a bounty if upheld, forfeited if not.
          </p>
        </div>
        <div className="ante__wallet-col">
          <WalletBadge
            address={address}
            kind={walletKind}
            onConnect={() => void connect().catch(() => {})}
          />
          <PasskeyCaveat />
        </div>
      </header>

      {!configured && (
        <div className="ante__banner ante__banner--warn">
          Chain not configured. Set <code>VITE_RPC_URL</code>,{" "}
          <code>VITE_CHAIN_ID</code>, <code>VITE_ANTE_ADDRESS</code>, and{" "}
          <code>VITE_TOKEN_ADDRESS</code> (see <code>.env.example</code>) to load
          live comments.
        </div>
      )}

      {error && (
        <div className="ante__banner ante__banner--error" role="alert">
          {error}
        </div>
      )}

      <Composer
        symbol={symbol}
        minStakeHuman={minStakeHuman}
        onPost={ante.post}
        disabled={!configured}
      />

      <div className="ante__list">
        {loading && comments.length === 0 ? (
          <p className="ante__empty">Loading comments…</p>
        ) : comments.length === 0 ? (
          <p className="ante__empty">No comments yet. Be the first to stake.</p>
        ) : (
          comments.map((c) => (
            <CommentCard
              key={c.id.toString()}
              comment={c}
              symbol={symbol}
              format={format}
              connectedAddress={address}
              challengeWindow={challengeWindow}
              minFlagBondHuman={minFlagBondHuman}
              minStake={minStake}
              flagBountyBps={flagBountyBps}
              isModerator={isModerator}
              onWithdraw={ante.withdraw}
              onTip={ante.tip}
              onFlag={ante.flag}
              onResolveFlag={ante.resolveFlag}
            />
          ))
        )}
      </div>
    </section>
  );
}

// --- Wallet badge ----------------------------------------------------------

function WalletBadge({
  address,
  kind,
  onConnect,
}: {
  address: Address | null;
  kind: WalletKind | null;
  onConnect: () => void;
}) {
  if (address) {
    return (
      <div className="ante__wallet" title={address}>
        <span className="ante__dot" />
        {kind === "passkey" ? "Passkey" : "Dev key"} · {shortAddr(address)}
      </div>
    );
  }
  return (
    <button className="ante__btn ante__btn--ghost" onClick={onConnect}>
      Connect wallet
    </button>
  );
}

// Always-visible passkey caveat. Covers BOTH binding axes plus the
// standalone≠embed realm boundary (§1/§3): the DOMAIN axis (a passkey is scoped
// to this site's registrable domain, so a stake here is invisible on any other
// Ante surface, including the standalone app) AND the DEVICE/authenticator axis
// (it lives on this device, or wherever the platform syncs the passkey). The
// substrings "tied to this site", "separate from any other Ante site", "only on
// this device", and "where this passkey" satisfy the rewording-proof grep gate.
function PasskeyCaveat() {
  return (
    <p className="ante__passkey-caveat">
      Your passkey and staked funds are tied to this site (separate from any
      other Ante site, including the standalone app) and exist only on this
      device (or wherever this passkey is synced). They cannot be recovered from
      another domain, or if this passkey is lost.
    </p>
  );
}

// --- Composer --------------------------------------------------------------

function Composer({
  symbol,
  minStakeHuman,
  onPost,
  disabled,
}: {
  symbol: string;
  minStakeHuman: string | null;
  onPost: (content: string, humanStake: string) => Promise<unknown>;
  disabled: boolean;
}) {
  const [content, setContent] = useState("");
  const [stake, setStake] = useState(minStakeHuman ?? "");
  const [stakeTouched, setStakeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Default the stake field to minStake once it loads from chain (minStakeHuman
  // is null on first render), until the user edits it.
  useEffect(() => {
    if (!stakeTouched && minStakeHuman != null) setStake(minStakeHuman);
  }, [minStakeHuman, stakeTouched]);

  const stakeValue = stake;

  const submit = async () => {
    if (!content.trim()) {
      setStatus("Write something first.");
      return;
    }
    setBusy(true);
    setStatus("Approving + posting… confirm in your wallet.");
    try {
      await onPost(content.trim(), stakeValue);
      setContent("");
      setStatus("Posted. Your stake is locked until the challenge window ends.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ante__composer">
      <textarea
        className="ante__textarea"
        placeholder="Say something worth staking on…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={disabled || busy}
        rows={3}
      />
      <div className="ante__composer-row">
        <label className="ante__stake-field">
          Stake
          <input
            className="ante__input"
            type="text"
            inputMode="decimal"
            value={stakeValue}
            onChange={(e) => {
              setStakeTouched(true);
              setStake(e.target.value);
            }}
            disabled={disabled || busy}
          />
          {symbol}
        </label>
        <button
          className="ante__btn ante__btn--primary"
          onClick={() => void submit()}
          disabled={disabled || busy}
        >
          {busy ? "Posting…" : `Stake ${stakeValue} ${symbol} to post`}
        </button>
      </div>
      <p className="ante__refund">
        Refundable. You get your {stakeValue} {symbol} back after the challenge
        window unless the comment is flagged and removed.
      </p>
      {status && <p className="ante__composer-status">{status}</p>}
    </div>
  );
}

// --- Comment card ----------------------------------------------------------

function CommentCard({
  comment,
  symbol,
  format,
  connectedAddress,
  challengeWindow,
  minFlagBondHuman,
  minStake,
  flagBountyBps,
  isModerator,
  onWithdraw,
  onTip,
  onFlag,
  onResolveFlag,
}: {
  comment: AnteComment;
  symbol: string;
  format: (n: bigint) => string;
  connectedAddress: Address | null;
  challengeWindow: number | null;
  minFlagBondHuman: string | null;
  minStake: bigint | null;
  flagBountyBps: number | null;
  isModerator: boolean;
  onWithdraw: (id: bigint) => Promise<unknown>;
  onTip: (id: bigint, amount: string) => Promise<unknown>;
  onFlag: (id: bigint, bond: string, reason: string) => Promise<unknown>;
  onResolveFlag: (
    id: bigint,
    uphold: boolean,
    reason: string
  ) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<
    null | "withdraw" | "tip" | "flag" | "resolve"
  >(null);
  const [note, setNote] = useState<string | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipAmount, setTipAmount] = useState("1");
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [bond, setBond] = useState(minFlagBondHuman ?? "1");
  const [reason, setReason] = useState("");

  const isAuthor =
    !!connectedAddress &&
    connectedAddress.toLowerCase() === comment.author.toLowerCase();

  // Stake relative to the minimum — a quiet confidence signal. Only surfaced
  // when a comment is bonded meaningfully above the floor (>= 1.5x), so a
  // minimum-stake comment shows nothing. Kept understated by design; the credible
  // signal is "this author risked more on not being removed."
  const stakeMultiple =
    minStake != null && minStake > 0n
      ? Number(comment.stake) / Number(minStake)
      : null;
  const showStakeMultiple = stakeMultiple != null && stakeMultiple >= 1.5;
  const stakeMultipleLabel =
    stakeMultiple == null
      ? ""
      : stakeMultiple >= 10
        ? Math.round(stakeMultiple).toString()
        : (Math.round(stakeMultiple * 10) / 10).toString();

  const isChallenged =
    comment.status === "Challenged" && comment.challenge?.open === true;

  const windowEnds = challengeWindow != null
    ? comment.postedAt + challengeWindow
    : null;
  const windowElapsed =
    windowEnds != null ? Date.now() / 1000 > windowEnds : false;

  const canWithdraw =
    isAuthor && comment.status === "Active" && windowElapsed;

  // Only Active comments can be challenged (matches the contract's NotActive
  // guard). Authors can't usefully challenge their own comment.
  const canChallenge = comment.status === "Active" && !isAuthor;

  const run = async (
    which: "withdraw" | "tip" | "flag" | "resolve",
    fn: () => Promise<unknown>,
    pending: string,
    done: string
  ) => {
    setBusy(which);
    setNote(pending);
    try {
      await fn();
      setNote(done);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const bountyPct =
    flagBountyBps != null ? (flagBountyBps / 100).toString() : null;

  return (
    <article className="ante__card">
      <div className="ante__card-head">
        <span className="ante__author" title={comment.author}>
          {shortAddr(comment.author)}
        </span>
        <StatusBadge status={comment.status} />
        <span className="ante__time">{timeAgo(comment.postedAt)}</span>
      </div>

      <p className="ante__content">{comment.content}</p>

      <div className="ante__meta">
        <span className="ante__chip">
          Staked {format(comment.stake)} {symbol}
        </span>
        {showStakeMultiple && (
          <span
            className="ante__chip ante__chip--stake-mult"
            title="Bond relative to the minimum — a higher stake signals the author's confidence the comment won't be removed."
          >
            {stakeMultipleLabel}× min
          </span>
        )}
        {comment.tips > 0n && (
          <span className="ante__chip ante__chip--tip">
            Tipped {format(comment.tips)} {symbol}
          </span>
        )}
        {isChallenged && comment.challenge && (
          <span
            className="ante__chip ante__chip--challenge"
            title={comment.challenge.flagger}
          >
            Challenged by {shortAddr(comment.challenge.flagger)} ·{" "}
            {format(comment.challenge.bond)} {symbol} bond
          </span>
        )}
      </div>

      {isChallenged && (
        <p className="ante__window-note">
          A moderator is reviewing this challenge. The author can't withdraw
          until it's resolved.
        </p>
      )}

      <div className="ante__actions">
        {canWithdraw && (
          <button
            className="ante__btn ante__btn--primary ante__btn--sm"
            disabled={busy !== null}
            onClick={() =>
              void run(
                "withdraw",
                () => onWithdraw(comment.id),
                "Reclaiming stake…",
                "Stake reclaimed."
              )
            }
          >
            Reclaim {format(comment.stake)} {symbol}
          </button>
        )}

        {tipOpen ? (
          <span className="ante__tip-inline">
            <input
              className="ante__input ante__input--sm"
              type="text"
              inputMode="decimal"
              value={tipAmount}
              onChange={(e) => setTipAmount(e.target.value)}
              disabled={busy !== null}
            />
            <button
              className="ante__btn ante__btn--sm"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "tip",
                  () => onTip(comment.id, tipAmount),
                  "Sending tip…",
                  "Tip sent."
                ).then(() => setTipOpen(false))
              }
            >
              Send {tipAmount} {symbol}
            </button>
            <button
              className="ante__btn ante__btn--ghost ante__btn--sm"
              onClick={() => setTipOpen(false)}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="ante__btn ante__btn--ghost ante__btn--sm"
            disabled={busy !== null}
            onClick={() => setTipOpen(true)}
          >
            Tip
          </button>
        )}

        {canChallenge && !challengeOpen && (
          <button
            className="ante__btn ante__btn--ghost ante__btn--sm ante__btn--flag"
            disabled={busy !== null}
            onClick={() => setChallengeOpen(true)}
            title="Stake a bond to challenge this comment for moderator review"
          >
            Challenge{minFlagBondHuman ? ` (stake ${minFlagBondHuman} ${symbol})` : ""}
          </button>
        )}
      </div>

      {canChallenge && challengeOpen && (
        <div className="ante__challenge-panel">
          <p className="ante__challenge-explain">
            Challenging stakes a bond of at least{" "}
            <strong>
              {minFlagBondHuman ?? "?"} {symbol}
            </strong>
            . If a moderator <strong>upholds</strong> it, the comment is removed,
            you get your bond back{bountyPct ? ` plus a ${bountyPct}% bounty` : ""}{" "}
            of the slashed stake. If the comment is fine, your bond is{" "}
            <strong>forfeited</strong>.
          </p>
          <div className="ante__tip-inline">
            <label className="ante__stake-field">
              Bond
              <input
                className="ante__input ante__input--sm"
                type="text"
                inputMode="decimal"
                value={bond}
                onChange={(e) => setBond(e.target.value)}
                disabled={busy !== null}
              />
              {symbol}
            </label>
          </div>
          <input
            className="ante__input ante__input--sm"
            type="text"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy !== null}
          />
          <div className="ante__tip-inline">
            <button
              className="ante__btn ante__btn--sm ante__btn--flag"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "flag",
                  () =>
                    onFlag(
                      comment.id,
                      bond,
                      reason.trim() || "challenged from widget"
                    ),
                  "Approving + staking challenge bond… confirm in your wallet.",
                  "Challenge submitted. Awaiting moderator review."
                ).then(() => setChallengeOpen(false))
              }
            >
              Stake {bond} {symbol} to challenge
            </button>
            <button
              className="ante__btn ante__btn--ghost ante__btn--sm"
              onClick={() => setChallengeOpen(false)}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isModerator && isChallenged && (
        <ModeratorPanel
          busy={busy === "resolve"}
          disabled={busy !== null}
          onResolve={(uphold, modReason) =>
            run(
              "resolve",
              () => onResolveFlag(comment.id, uphold, modReason),
              uphold ? "Upholding challenge…" : "Rejecting challenge…",
              uphold
                ? "Upheld — comment slashed, flagger rewarded."
                : "Rejected — bond forfeited, comment restored."
            )
          }
        />
      )}

      {!windowElapsed && comment.status === "Active" && windowEnds != null && (
        <p className="ante__window-note">
          Stake locked until {new Date(windowEnds * 1000).toLocaleString()}.
        </p>
      )}

      {note && <p className="ante__card-status">{note}</p>}
    </article>
  );
}

// --- Moderator panel -------------------------------------------------------
// Clearly separated from the reader UI; only rendered when the connected
// wallet is a moderator AND there's an open challenge to resolve.

function ModeratorPanel({
  busy,
  disabled,
  onResolve,
}: {
  busy: boolean;
  disabled: boolean;
  onResolve: (uphold: boolean, reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="ante__mod-panel">
      <div className="ante__mod-head">Moderator · resolve challenge</div>
      <input
        className="ante__input ante__input--sm"
        type="text"
        placeholder="Resolution reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={disabled}
      />
      <div className="ante__tip-inline">
        <button
          className="ante__btn ante__btn--primary ante__btn--sm"
          disabled={disabled}
          onClick={() =>
            void onResolve(true, reason.trim() || "upheld by moderator")
          }
        >
          {busy ? "Resolving…" : "Uphold (slash)"}
        </button>
        <button
          className="ante__btn ante__btn--ghost ante__btn--sm"
          disabled={disabled}
          onClick={() =>
            void onResolve(false, reason.trim() || "rejected by moderator")
          }
        >
          Reject (forfeit bond)
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: CommentStatus }) {
  const cls =
    status === "Active"
      ? "ante__badge--active"
      : status === "Withdrawn"
        ? "ante__badge--withdrawn"
        : status === "Challenged"
          ? "ante__badge--challenged"
          : "ante__badge--slashed";
  return <span className={`ante__badge ${cls}`}>{status}</span>;
}

// --- helpers ---------------------------------------------------------------

function shortAddr(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function timeAgo(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
