import { useMemo, useState } from "react";
import { isAddress, type Address, type Hash } from "viem";
import { useAnte, type AnteComment } from "../hooks/useAnte";
import {
  useAnteAdmin,
  BPS_DENOMINATOR,
  MAX_CHALLENGE_WINDOW_SECS,
} from "../hooks/useAnteAdmin";
import { useAnteConfig } from "../config/AnteProvider";
import { isMainnet } from "../config/chain";
import "./AdminPanel.css";

// ---------------------------------------------------------------------------
// AdminPanel — wallet-gated operator console for an Ante deployment.
//
// Standalone-only (mounted from App at `#/admin`); never bundled into the embed
// widget. Three sections: blog setup + embed (the hero, orients a new operator),
// owner config (the seven on-chain params + moderator roster), and moderation
// (slash / resolve open challenges). Owner-only and moderator-only actions are
// hard-gated and clearly explain why they're disabled when the connected wallet
// lacks the role — the on-chain guards are the real enforcement, this is UX.
// ---------------------------------------------------------------------------

const MAX_UINT96 = (1n << 96n) - 1n;

export function AdminPanel() {
  const ante = useAnte();
  const admin = useAnteAdmin(ante.address);
  const config = useAnteConfig();

  const symbol = ante.token?.symbol ?? "tokens";

  return (
    <main className="admin">
      <header className="admin__head">
        <div>
          <h1 className="admin__title">Ante · Admin console</h1>
          <p className="admin__subtitle">
            Owner &amp; moderator controls for your comment contract. Actions are
            enforced on-chain; this panel just wires your wallet to them.
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
        isOwner={admin.isOwner}
        isModerator={ante.isModerator}
        owner={admin.owner}
      />

      <SetupSection ante={ante} admin={admin} config={config} symbol={symbol} />

      <OwnerConfigSection ante={ante} admin={admin} symbol={symbol} />

      <ModerationSection ante={ante} admin={admin} symbol={symbol} />
    </main>
  );
}

// --- Role banner -----------------------------------------------------------

function RoleBanner({
  address,
  isOwner,
  isModerator,
  owner,
}: {
  address: Address | null;
  isOwner: boolean;
  isModerator: boolean;
  owner: Address | null;
}) {
  if (!address) {
    return (
      <div className="admin__role admin__role--none">
        No wallet connected. Connect to see whether you're the owner or a
        moderator of this contract.
      </div>
    );
  }
  return (
    <div className="admin__role">
      <span className={`admin__pill ${isOwner ? "is-on" : ""}`}>
        {isOwner ? "✓ Owner" : "Not owner"}
      </span>
      <span className={`admin__pill ${isModerator ? "is-on" : ""}`}>
        {isModerator ? "✓ Moderator" : "Not moderator"}
      </span>
      {owner && (
        <span className="admin__owner-of" title={owner}>
          Owner: <code>{shortAddr(owner)}</code>
        </span>
      )}
    </div>
  );
}

// --- Section 1: Blog setup + embed (the hero) ------------------------------

function SetupSection({
  ante,
  admin,
  config,
  symbol,
}: {
  ante: ReturnType<typeof useAnte>;
  admin: ReturnType<typeof useAnteAdmin>;
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
      label: "Connect your operator wallet",
      detail: "The passkey/dev wallet you deployed (or will moderate) from.",
    },
    {
      done: admin.isOwner || ante.isModerator,
      label: "Confirm your role",
      detail: admin.isOwner
        ? "You're the owner — you can set params and manage moderators."
        : ante.isModerator
          ? "You're a moderator — you can resolve challenges and slash."
          : "Not yet owner or moderator on this contract.",
    },
    {
      done: ante.minStake != null && ante.challengeWindow != null,
      label: "Configure your parameters",
      detail: "Set minStake, bond, bounty, tip fee and challenge window below.",
    },
    {
      done: ante.isModerator,
      label: "Add yourself as a moderator",
      detail:
        "So you can resolve challenges. Use the moderator form in Owner config.",
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

// --- Section 2: Owner config ----------------------------------------------

function OwnerConfigSection({
  ante,
  admin,
  symbol,
}: {
  ante: ReturnType<typeof useAnte>;
  admin: ReturnType<typeof useAnteAdmin>;
  symbol: string;
}) {
  const disabled = !ante.configured || !admin.isOwner;
  const reason = !ante.configured
    ? "Chain not configured."
    : !admin.isOwner
      ? "Owner-only. Connect the contract owner's wallet to change these."
      : undefined;

  const afterWrite = async () => {
    await ante.refresh();
    await admin.refresh();
  };

  return (
    <section className="admin__section">
      <h2 className="admin__h2">Owner config</h2>
      <p className="admin__section-note">
        On-chain contract parameters. {admin.isOwner
          ? "You're the owner — changes take one signed transaction each."
          : "Read-only unless the connected wallet is the contract owner."}
      </p>

      <div className="admin__grid">
        <SetterForm
          label="Minimum stake"
          unit={symbol}
          current={ante.minStake != null ? `${ante.format(ante.minStake)} ${symbol}` : "—"}
          initial={ante.minStake != null ? ante.format(ante.minStake) : ""}
          disabled={disabled}
          disabledReason={reason}
          hint="Least a commenter must stake to post. Must be > 0."
          action={async (raw) => {
            const amount = ante.parse(raw);
            if (amount <= 0n) throw new Error("Must be greater than zero.");
            if (amount > MAX_UINT96) throw new Error("Exceeds uint96 max.");
            const h = await admin.setMinStake(amount);
            await afterWrite();
            return h;
          }}
        />

        <SetterForm
          label="Minimum flag bond"
          unit={symbol}
          current={ante.minFlagBond != null ? `${ante.format(ante.minFlagBond)} ${symbol}` : "—"}
          initial={ante.minFlagBond != null ? ante.format(ante.minFlagBond) : ""}
          disabled={disabled}
          disabledReason={reason}
          hint="Bond a challenger must stake to flag. Must be > 0."
          action={async (raw) => {
            const amount = ante.parse(raw);
            if (amount <= 0n) throw new Error("Must be greater than zero.");
            if (amount > MAX_UINT96) throw new Error("Exceeds uint96 max.");
            const h = await admin.setMinFlagBond(amount);
            await afterWrite();
            return h;
          }}
        />

        <SetterForm
          label="Flag bounty"
          unit="bps"
          current={ante.flagBountyBps != null ? `${ante.flagBountyBps} bps (${(ante.flagBountyBps / 100).toFixed(2)}%)` : "—"}
          initial={ante.flagBountyBps != null ? String(ante.flagBountyBps) : ""}
          disabled={disabled}
          disabledReason={reason}
          hint={`Share of a slashed stake paid to an upholding flagger. 0–${BPS_DENOMINATOR} bps.`}
          action={async (raw) => {
            const bps = parseBps(raw);
            const h = await admin.setFlagBountyBps(bps);
            await afterWrite();
            return h;
          }}
        />

        <SetterForm
          label="Tip fee"
          unit="bps"
          current={admin.tipFeeBps != null ? `${admin.tipFeeBps} bps (${(admin.tipFeeBps / 100).toFixed(2)}%)` : "—"}
          initial={admin.tipFeeBps != null ? String(admin.tipFeeBps) : ""}
          disabled={disabled}
          disabledReason={reason}
          hint={`Share of each tip routed to the treasury. 0–${BPS_DENOMINATOR} bps.`}
          action={async (raw) => {
            const bps = parseBps(raw);
            const h = await admin.setTipFeeBps(bps);
            await afterWrite();
            return h;
          }}
        />

        <SetterForm
          label="Challenge window"
          unit="seconds"
          current={
            ante.challengeWindow != null
              ? `${ante.challengeWindow}s (${humanDuration(ante.challengeWindow)})`
              : "—"
          }
          initial={ante.challengeWindow != null ? String(ante.challengeWindow) : ""}
          disabled={disabled}
          disabledReason={reason}
          hint={`Seconds a stake stays locked / flaggable. 1 – ${MAX_CHALLENGE_WINDOW_SECS} (30 days).`}
          action={async (raw) => {
            const secs = Math.trunc(Number(raw));
            if (!Number.isFinite(secs) || secs <= 0)
              throw new Error("Must be a positive number of seconds.");
            if (secs > MAX_CHALLENGE_WINDOW_SECS)
              throw new Error("Exceeds the 30-day maximum.");
            const h = await admin.setChallengeWindow(secs);
            await afterWrite();
            return h;
          }}
        />

        <SetterForm
          label="Treasury"
          unit=""
          current={admin.treasury ? shortAddr(admin.treasury) : "—"}
          currentTitle={admin.treasury ?? undefined}
          initial={admin.treasury ?? ""}
          disabled={disabled}
          disabledReason={reason}
          mono
          hint="Address that receives tip fees. Cannot be the zero address."
          action={async (raw) => {
            const addr = raw.trim();
            if (!isAddress(addr)) throw new Error("Not a valid address.");
            const h = await admin.setTreasury(addr as Address);
            await afterWrite();
            return h;
          }}
        />
      </div>

      <ModeratorForm ante={ante} admin={admin} disabled={disabled} disabledReason={reason} />
    </section>
  );
}

function ModeratorForm({
  ante,
  admin,
  disabled,
  disabledReason,
}: {
  ante: ReturnType<typeof useAnte>;
  admin: ReturnType<typeof useAnteAdmin>;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState<null | "add" | "remove" | "check">(null);
  const [status, setStatus] = useState<StatusMsg | null>(null);

  const run = async (allowed: boolean) => {
    const which = allowed ? "add" : "remove";
    if (!isAddress(addr.trim())) {
      setStatus({ kind: "err", msg: "Enter a valid address first." });
      return;
    }
    setBusy(which);
    setStatus({ kind: "pending", msg: "Submitting… confirm in your wallet." });
    try {
      const hash = await admin.setModerator(addr.trim() as Address, allowed);
      setStatus({
        kind: "ok",
        msg: `${allowed ? "Added" : "Removed"} moderator · tx ${shortAddr(hash)}`,
      });
      await ante.refresh();
    } catch (e) {
      setStatus({ kind: "err", msg: errMsg(e) });
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    if (!isAddress(addr.trim())) {
      setStatus({ kind: "err", msg: "Enter a valid address first." });
      return;
    }
    setBusy("check");
    try {
      const is = await admin.readModerator(addr.trim() as Address);
      setStatus({
        kind: "ok",
        msg: is ? "Is currently a moderator." : "Not a moderator.",
      });
    } finally {
      setBusy(null);
    }
  };

  const fillSelf = () => {
    if (ante.address) setAddr(ante.address);
  };

  return (
    <div className="admin__mods">
      <div className="admin__mods-head">
        <h3 className="admin__h3">Moderators</h3>
        {ante.address && (
          <button type="button" className="admin__linkbtn" onClick={fillSelf}>
            Use my address
          </button>
        )}
      </div>
      <p className="admin__hint">
        Grant or revoke the moderator role (resolve challenges + slash). Add
        yourself here before you can moderate.
      </p>
      <div className="admin__mods-row">
        <input
          className="admin__input admin__input--mono admin__input--grow"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="0x… moderator address"
          disabled={disabled || busy !== null}
        />
        <button
          className="admin__btn"
          disabled={disabled || busy !== null}
          onClick={() => void check()}
          title="Read the on-chain moderator flag (no transaction)"
        >
          Check
        </button>
        <button
          className="admin__btn admin__btn--primary"
          disabled={disabled || busy !== null}
          onClick={() => void run(true)}
        >
          {busy === "add" ? "Adding…" : "Add"}
        </button>
        <button
          className="admin__btn admin__btn--danger"
          disabled={disabled || busy !== null}
          onClick={() => void run(false)}
        >
          {busy === "remove" ? "Removing…" : "Remove"}
        </button>
      </div>
      {disabled && disabledReason && (
        <p className="admin__disabled-note">{disabledReason}</p>
      )}
      {status && <StatusLine status={status} />}
    </div>
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
      ? "Moderator-only. Connect a moderator wallet (add one in Owner config) to act."
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

// --- Reusable setter form --------------------------------------------------

function SetterForm({
  label,
  unit,
  current,
  currentTitle,
  initial,
  hint,
  disabled,
  disabledReason,
  mono,
  action,
}: {
  label: string;
  unit: string;
  current: string;
  currentTitle?: string;
  initial: string;
  hint: string;
  disabled: boolean;
  disabledReason?: string;
  mono?: boolean;
  action: (raw: string) => Promise<Hash>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMsg | null>(null);

  const submit = async () => {
    setBusy(true);
    setStatus({ kind: "pending", msg: "Submitting… confirm in your wallet." });
    try {
      const hash = await action(value);
      setStatus({ kind: "ok", msg: `Updated · tx ${shortAddr(hash)}` });
    } catch (e) {
      setStatus({ kind: "err", msg: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin__setter">
      <div className="admin__setter-top">
        <span className="admin__setter-label">{label}</span>
        <span className="admin__setter-current" title={currentTitle}>
          {current}
        </span>
      </div>
      <div className="admin__setter-row">
        <input
          className={`admin__input admin__input--grow${mono ? " admin__input--mono" : ""}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled || busy}
        />
        {unit && <span className="admin__setter-unit">{unit}</span>}
        <button
          className="admin__btn admin__btn--primary"
          onClick={() => void submit()}
          disabled={disabled || busy}
        >
          {busy ? "Saving…" : "Set"}
        </button>
      </div>
      <p className="admin__hint">{hint}</p>
      {disabled && disabledReason && (
        <p className="admin__disabled-note">{disabledReason}</p>
      )}
      {status && <StatusLine status={status} />}
    </div>
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

function parseBps(raw: string): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0)
    throw new Error("Must be a non-negative number.");
  if (n > BPS_DENOMINATOR)
    throw new Error(`Must be ${BPS_DENOMINATOR} bps (100%) or less.`);
  return n;
}

function humanDuration(secs: number): string {
  if (secs % 86400 === 0) return `${secs / 86400}d`;
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}

function shortAddr(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
