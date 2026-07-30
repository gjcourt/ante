import { useEffect, useState } from "react";
import { AnteComments } from "./components/AnteComments";
import { AdminPanel } from "./components/AdminPanel";
import { AnteProvider } from "./config/AnteProvider";
import "./App.css";

// Standalone app. Two views, both mounted inside a single <AnteProvider> so the
// wallet/config context is shared:
//   • the demo blog post with the embeddable <AnteComments /> widget, and
//   • the wallet-gated admin/moderation console at `#/admin`.
// Routing is hash-based (no router dep): `#/admin*` shows the console, anything
// else the demo. We listen to `hashchange` so the in-page links toggle live.
function hashIsAdmin(): boolean {
  return window.location.hash.startsWith("#/admin");
}

export default function App() {
  const [isAdmin, setIsAdmin] = useState(hashIsAdmin);

  useEffect(() => {
    const onHash = () => setIsAdmin(hashIsAdmin());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <AnteProvider>
      {isAdmin ? <AdminPanel /> : <Demo />}
    </AnteProvider>
  );
}

// The demo page that mounts the embeddable Ante widget. In production the host
// page embeds the <ante-comments> web component (see EMBEDDING.md) or imports
// <AnteComments /> directly. The standalone demo uses the env-derived default
// config (no per-post topic) — i.e. the global feed.
function Demo() {
  return (
    <main className="demo">
      <article className="demo__post">
        <h1 className="demo__title">The bond is the reputation system</h1>
        <p className="demo__byline">A demo blog post · Ante widget below</p>
        <p>
          Ante is a pseudonymous pay-to-comment widget. To comment, you post a
          small refundable stablecoin stake on the Tempo chain. Good comments
          get the stake back (and can earn tips). Flagged-and-upheld comments
          get the stake slashed. No account, no real identity — just a passkey,
          created right in your browser.
        </p>
      </article>

      <hr className="demo__rule" />

      <AnteComments />

      <footer className="demo__footer">
        Powered by Ante · stake-and-slash on Tempo ·{" "}
        <a className="demo__adminlink" href="#/admin">
          Admin
        </a>
      </footer>
    </main>
  );
}
