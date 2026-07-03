import { AnteComments } from "./components/AnteComments";
import { AnteProvider } from "./config/AnteProvider";
import "./App.css";

// Demo page that mounts the embeddable Ante widget. In production the host
// page embeds the <ante-comments> web component (see EMBEDDING.md) or imports
// <AnteComments /> directly. The standalone demo uses the env-derived default
// config (no per-post topic) — i.e. the global feed.
export default function App() {
  return (
    <AnteProvider>
      <main className="demo">
      <article className="demo__post">
        <h1 className="demo__title">The bond is the reputation system</h1>
        <p className="demo__byline">A demo blog post · Ante widget below</p>
        <p>
          Ante is a pseudonymous pay-to-comment widget. To comment, you post a
          small refundable stablecoin stake on the Tempo chain. Good comments
          get the stake back (and can earn tips). Flagged-and-upheld comments
          get the stake slashed. No account, no real identity — just a
          passkey, created right in your browser.
        </p>
      </article>

      <hr className="demo__rule" />

      <AnteComments />

        <footer className="demo__footer">
          Powered by Ante · stake-and-slash on Tempo
        </footer>
      </main>
    </AnteProvider>
  );
}
