import { useMemo, useState } from "react";
import { type Address, type Hash } from "viem";
import { useAnte, type AnteComment } from "../hooks/useAnte";
import { useAnteAdmin } from "../hooks/useAnteAdmin";
import { useAnteConfig } from "../config/AnteProvider";
import { isMainnet } from "../config/chain";
import "./AdminPanel.css";

// ---------------------------------------------------------------------------
// AdminPanel — wallet-gated MODERATION console for an Ante deployment.
//
// Standalone-only (mounted from App at `#/admin`); never bundled into the embed
// widget. Three sections: blog setup + embed (the hero, orients a new operator),
// owner configuration (read-only — those params live on the Timelock CLI, see
// below), and moderation (slash / resolve open challenges).
//
// Ante v2's owner is a TimelockController, not an EOA, so the seven owner
// setters can't be called from a browser wallet (they'd revert). Owner
// governance runs on the hardware CLI (Trezor proposer queues → 8-day delay →
// execute); this panel only reads those values back. The one privileged action
// it still performs is moderation, gated on `ante.isModerator` — the on-chain
// guard is the real enforcement, this is UX.
// ---------------------------------------------------------------------------

export function AdminPanel() {
  const ante = useAnte();
  const admin = useAnteAdmin(ante.address);
  const config = useAnteConfig();

  const symbol = ante.token?.symbol ?? "tokens";

  return (
    <main className="admin">
      <header className="admin__head">
        <div>
          <h1 className="admin__title">Ante · Moderation console</h1>
          <p className="admin__subtitle">
            Moderator controls for your comment contract, plus the embed setup.
            Owner parameters are governed on the timelock CLI (read-only here);
            moderation is enforced on-chain and this panel wires your wallet to it.
          </p>
        </div>
        <div className="admin__wallet-col">
          <WalletBadge
            address={ante.address}
            kind={ante.walletKind}
            onConnect={() => void ante.connect().catch(() => {})}
          />
          <a className="admin__navlink" href="#/">
            ← Back to the demo
          </a>
        </div>
      </header>

      {!ante.configured && (
        <div className="admin__banner admin__banner--warn">
          Chain not configured — set <code>VITE_ANTE_ADDRESS</code> (and the
          other <code>VITE_*</code> values, see <code>.env.example</code>). On-chain
          reads and writes stay disabled until a real Ante address is set.
        </div>
      )}
      {(ante.error || admin.error) && (
        <div className="admin__banner admin__banner--error" role="alert">
          {ante.error ?? admin.error}
        </div>
      )}

      <RoleBanner
        address={ante.address}
        isModerator={ante.isModerator}
        owner={admin.owner}
      />

      <SetupSection ante={ante} config={config} symbol={symbol} />

      <ModerationSection ante={ante} admin={admin} symbol={symbol} />

      <OwnerConfigInfo admin={admin} symbol={symbol} />
    </main>
  );
}

// --- Role banner -----------------------------------------------------------

function RoleBanner({
  address,
  isModerator,
  owner,
}: {
  address: Address | null;
  isModerator: boolean;
  owner: Address | null;
}) {
  if (!address) {
    return (
      <div className="admin__role admin__role--none">
        No wallet connected. Connect to see whether you're a moderator of this
        contract.
      </div>
    );
  }
  return (
    <div className="admin__role">
      <span className={`admin__pill ${isModerator ? "is-on" : ""}`}>
        {isModerator ? "✓ Moderator" : "Not moderator"}
      </span>
      {owner && (
        // Owner is the TimelockController, never the connected wallet — shown as
        // a read-only fact so operators can confirm which timelock governs this
        // deployment.
        <span className="admin__owner-of" title={owner}>
          Owner (timelock): <code>{shortAddr(owner)}</code>
        </span>
      )}
    </div>
  );
}

// --- Section 1: Blog setup + embed (the hero) ------------------------------

function SetupSection({
  ante,
  config,
  symbol,
}: {
  ante: ReturnType<typeof useAnte>;
  config: ReturnType<typeof useAnteConfig>;
  symbol: string;
}) {
  const [slug, setSlug] = useState("my-first-post");
  const [scriptUrl, setScriptUrl] = useState("https://cdn.example.com/ante.js");
  const chainLabel = isMainnet(config)
    ? `Tempo mainnet (${config.chainId})`
    : `Tempo testnet · Moderato (${config.chainId})`;

  const snippet = useMemo(
    () =>
      buildEmbedSnippet({
        slug,
        scriptUrl,
        anteAddress: config.anteAddress,
        tokenAddress: config.tokenAddress,
        rpcUrl: config.rpcUrl,
        chainId: config.chainId,
        explorerUrl: config.explorerUrl,
      }),
    [slug, scriptUrl, config]
  );

  const steps: { done: boolean; label: string; detail: string }[] = [
    {
      done: !!ante.address,
      label: "Connect your moderator wallet",
      detail: "The passkey/dev wallet you moderate from.",
    },
    {
      done: ante.isModerator,
      label: "Confirm your moderator role",
      detail: ante.isModerator
        ? "You're a moderator — you can resolve challenges and slash."
        : "Not yet a moderator. The role is granted on the timelock CLI " +
          "(see docs/timelock-deploy-runbook.md), not from this panel.",
    },
    {
      done: false,
      label: "Copy the embed onto your blog",
      detail: "Paste the snippet below into your post template.",
    },
  ];

  return (
    <section className="admin__section admin__section--hero">
      <h2 className="admin__h2">Set up your blog</h2>

      <div className="admin__facts">
        <Fact label="Wallet" value={ante.address ? shortAddr(ante.address) : "—"} title={ante.address ?? undefined} />
        <Fact label="Contract" value={shortAddr(config.anteAddress)} title={config.anteAddress} />
        <Fact label="Token" value={`${symbol}`} title={config.tokenAddress} />
        <Fact label="Chain" value={chainLabel} />
      </div>

      <ol className="admin__checklist">
        {steps.map((s, i) => (
          <li key={i} className={`admin__step ${s.done ? "is-done" : ""}`}>
            <span className="admin__step-mark">{s.done ? "✓" : i + 1}</span>
            <span>
              <strong>{s.label}</strong>
              <span className="admin__step-detail">{s.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="admin__embed">
        <div className="admin__embed-fields">
          <label className="admin__field">
            <span>Post slug</span>
            <input
              className="admin__input"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-first-post"
            />
          </label>
          <label className="admin__field admin__field--wide">
            <span>Hosted script URL</span>
            <input
              className="admin__input"
              value={scriptUrl}
              onChange={(e) => setScriptUrl(e.target.value)}
              placeholder="https://cdn.example.com/ante.js"
            />
          </label>
        </div>
        <p className="admin__hint">
          Each page passes its <code>slug</code>; the widget hashes it to the
          on-chain topic so only that post's thread loads. Build the bundle with{" "}
          <code>npm run build:embed</code> and host <code>ante.js</code> over
          HTTPS (see <code>EMBEDDING.md</code>).
        </p>
        <div className="admin__code-wrap">
          <pre className="admin__code">
            <code>{snippet}</code>
          </pre>
          <CopyButton text={snippet} label="Copy embed" />
        </div>
      </div>
    </section>
  );
}

// --- Owner configuration (read-only) --------------------------------------
//
// Under Ante v2 the contract owner is a TimelockController, so these params
// can't be set from a browser wallet — the seven owner setters would revert.
// This block is honest about that: it reads back the values the panel already
// has and points at the CLI where governance actually happens.

function OwnerConfigInfo({
  admin,
  symbol,
}: {
  admin: ReturnType<typeof useAnteAdmin>;
  symbol: string;
}) {
  return (
    <section className="admin__section">
      <h2 className="admin__h2">Owner configuration</h2>
      <p className="admin__section-note">
        Owner parameters — <code>minStake</code>, <code>minFlagBond</code>,{" "}
        <code>flagBountyBps</code>, <code>tipFeeBps</code>,{" "}
        <code>challengeWindow</code>, <code>treasury</code>, and the moderator
        set — are governed by the <strong>TimelockController</strong> on the
        hardware CLI, not this panel. A Trezor proposer queues a change (
        <code>timelock.schedule()</code>), it waits out the 8-day delay, then it's
        executed. See <code>docs/timelock-deploy-runbook.md</code>. Direct owner
        calls from a browser wallet revert, so they've been removed here.
      </p>

      <div className="admin__facts">
        <Fact
          label="Owner (timelock)"
          value={admin.owner ? shortAddr(admin.owner) : "—"}
          title={admin.owner ?? undefined}
        />
        <Fact
          label="Treasury"
          value={admin.treasury ? shortAddr(admin.treasury) : "—"}
          title={admin.treasury ?? undefined}
        />
        <Fact
          label="Tip fee"
          value={
            admin.tipFeeBps != null
              ? `${admin.tipFeeBps} bps (${(admin.tipFeeBps / 100).toFixed(2)}%)`
              : "—"
          }
        />
      </div>
      <p className="admin__hint">
        Tip fees on this contract route to the treasury above, denominated in{" "}
        {symbol}.
      </p>
    </section>
  );
}

// --- Section 3: Moderation -------------------------------------------------

function ModerationSection({
  ante,
  admin,
  symbol,
}: {
  ante: ReturnType<typeof useAnte>;
  admin: ReturnType<typeof useAnteAdmin>;
  symbol: string;
}) {
  // Actionable = an open challenge to resolve, or an Active comment a moderator
  // could slash directly. (Contract: slash requires Active; resolveFlag requires
  // an open challenge.)
  const rows = ante.comments.filter(
    (c) =>
      (c.status === "Challenged" && c.challenge?.open === true) ||
      c.status === "Active"
  );
  const openChallenges = rows.filter(
    (c) => c.status === "Challenged" && c.challenge?.open
  ).length;

  const disabled = !ante.configured || !ante.isModerator;
  const reason = !ante.configured
    ? "Chain not configured."
    : !ante.isModerator
      ? "Moderator-only. Connect a moderator wallet to act — the role is granted " +
        "on the timelock CLI (docs/timelock-deploy-runbook.md), not here."
      : undefined;

  return (
    <section className="admin__section">
      <h2 className="admin__h2">Moderation</h2>
      <p className="admin__section-note">
        {openChallenges > 0
          ? `${openChallenges} open challenge${openChallenges === 1 ? "" : "s"} awaiting review.`
          : "No open challenges."}{" "}
        Active comments can also be slashed directly.
      </p>
      {disabled && reason && <p className="admin__disabled-note">{reason}</p>}

      {rows.length === 0 ? (
        <p className="admin__empty">Nothing actionable right now.</p>
      ) : (
        <div className="admin__modlist">
          {rows.map((c) => (
            <ModerationRow
              key={c.id.toString()}
              comment={c}
              symbol={symbol}
              format={ante.format}
              disabled={disabled}
              onResolve={ante.resolveFlag}
              onSlash={async (id, r) => {
                const h = await admin.slash(id, r);
                await ante.refresh();
                return h;
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ModerationRow({
  comment,
  symbol,
  format,
  disabled,
  onResolve,
  onSlash,
}: {
  comment: AnteComment;
  symbol: string;
  format: (n: bigint) => string;
  disabled: boolean;
  onResolve: (id: bigint, uphold: boolean, reason: string) => Promise<Hash>;
  onSlash: (id: bigint, reason: string) => Promise<Hash>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<null | "uphold" | "reject" | "slash">(null);
  const [status, setStatus] = useState<StatusMsg | null>(null);
  const isChallenged =
    comment.status === "Challenged" && comment.challenge?.open === true;

  const act = async (
    which: "uphold" | "reject" | "slash",
    fn: () => Promise<Hash>,
    pending: string,
    ok: string
  ) => {
    setBusy(which);
    setStatus({ kind: "pending", msg: pending });
    try {
      const hash = await fn();
      setStatus({ kind: "ok", msg: `${ok} · tx ${shortAddr(hash)}` });
    } catch (e) {
      setStatus({ kind: "err", msg: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="admin__modcard">
      <div className="admin__modcard-head">
        <span className="admin__mono" title={comment.author}>
          #{comment.id.toString()} · {shortAddr(comment.author)}
        </span>
        <span className={`admin__status admin__status--${comment.status.toLowerCase()}`}>
          {comment.status}
        </span>
      </div>
      <p className="admin__modcard-body">{comment.content}</p>
      <div className="admin__modcard-meta">
        <span>Stake {format(comment.stake)} {symbol}</span>
        {comment.challenge && (
          <span title={comment.challenge.flagger}>
            Flagged by {shortAddr(comment.challenge.flagger)} ·{" "}
            {format(comment.challenge.bond)} {symbol} bond
          </span>
        )}
      </div>

      <input
        className="admin__input admin__input--grow"
        placeholder="Reason (recorded on-chain in the event)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={disabled || busy !== null}
      />

      <div className="admin__modcard-actions">
        {isChallenged ? (
          <>
            <button
              className="admin__btn admin__btn--danger"
              disabled={disabled || busy !== null}
              onClick={() =>
                void act(
                  "uphold",
                  () => onResolve(comment.id, true, reason.trim() || "upheld by moderator"),
                  "Upholding — slashing comment…",
                  "Upheld — comment slashed, flagger rewarded."
                )
              }
            >
              {busy === "uphold" ? "Upholding…" : "Uphold (slash)"}
            </button>
            <button
              className="admin__btn"
              disabled={disabled || busy !== null}
              onClick={() =>
                void act(
                  "reject",
                  () => onResolve(comment.id, false, reason.trim() || "rejected by moderator"),
                  "Rejecting challenge…",
                  "Rejected — bond forfeited, comment restored."
                )
              }
            >
              {busy === "reject" ? "Rejecting…" : "Reject challenge"}
            </button>
          </>
        ) : (
          <button
            className="admin__btn admin__btn--danger"
            disabled={disabled || busy !== null}
            onClick={() =>
              void act(
                "slash",
                () => onSlash(comment.id, reason.trim() || "slashed by moderator"),
                "Slashing comment…",
                "Comment slashed."
              )
            }
          >
            {busy === "slash" ? "Slashing…" : "Slash"}
          </button>
        )}
      </div>
      {status && <StatusLine status={status} />}
    </article>
  );
}

// --- Small shared pieces ---------------------------------------------------

interface StatusMsg {
  kind: "pending" | "ok" | "err";
  msg: string;
}

function StatusLine({ status }: { status: StatusMsg }) {
  return (
    <p className={`admin__txstatus admin__txstatus--${status.kind}`}>
      {status.msg}
    </p>
  );
}

function Fact({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="admin__fact" title={title}>
      <span className="admin__fact-label">{label}</span>
      <span className="admin__fact-value">{value}</span>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="admin__btn admin__btn--copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          },
          () => {}
        );
      }}
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}

function WalletBadge({
  address,
  kind,
  onConnect,
}: {
  address: Address | null;
  kind: string | null;
  onConnect: () => void;
}) {
  if (address) {
    return (
      <div className="admin__wallet" title={address}>
        <span className="admin__dot" />
        {kind === "passkey" ? "Passkey" : "Dev key"} · {shortAddr(address)}
      </div>
    );
  }
  return (
    <button className="admin__btn admin__btn--primary" onClick={onConnect}>
      Connect wallet
    </button>
  );
}

// --- helpers ---------------------------------------------------------------

function buildEmbedSnippet(o: {
  slug: string;
  scriptUrl: string;
  anteAddress: string;
  tokenAddress: string;
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
}): string {
  const slug = o.slug.trim() || "my-first-post";
  return `<ante-comments
  slug="${slug}"
  ante-address="${o.anteAddress}"
  token-address="${o.tokenAddress}"
  rpc-url="${o.rpcUrl}"
  chain-id="${o.chainId}"${
    o.explorerUrl ? `\n  explorer-url="${o.explorerUrl}"` : ""
  }
></ante-comments>
<script src="${o.scriptUrl.trim() || "https://cdn.example.com/ante.js"}" defer></script>`;
}

function shortAddr(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
