import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ---------------------------------------------------------------------------
// Embed build — emits ONE self-contained, self-registering bundle that defines
// the <ante-comments> custom element. React (and everything else) is bundled
// in, so a plain `<script src="ante.js">` on any static site works with no
// other tags. Output: dist-embed/ante.js (IIFE).
//
//   npm run build:embed
//
// The standalone app build (`npm run build`) is unaffected — it uses the
// default vite.config.ts + index.html entry.
// ---------------------------------------------------------------------------
export default defineConfig({
  plugins: [react()],
  // Inline `process.env.NODE_ENV` so React's production build is used in the
  // standalone bundle (no global `process` on a plain static page).
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    // Don't split CSS into a separate file — the element injects styles into its
    // shadow root from the `?inline` string imports, so a stray .css would be
    // dead weight (and easy to forget to host).
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/embed/ante-element.tsx"),
      name: "AnteComments",
      // IIFE so a bare <script src> self-registers the element on load.
      formats: ["iife"],
      fileName: () => "ante.js",
    },
    rollupOptions: {
      // Self-contained: bundle React et al. (no externals).
      output: {
        // Keep everything in one file; inline any dynamic imports (Turnkey SDK).
        inlineDynamicImports: true,
      },
    },
  },
});
