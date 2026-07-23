import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// https://vite.dev/config/
//
// WASM wiring (Phase 07): `wasm-pack build --target web` emits a self-
// initializing ES module whose `init()` fetches the `.wasm` asset at runtime.
// `vite-plugin-wasm` teaches Vite to handle that import; BOTH plugins must be
// registered under `worker.plugins` too, because the WASM module is
// instantiated inside the Web Worker in `src/wasm/worker.ts` (wasm instances
// aren't transferable across threads) and Vite transforms worker bundles
// independently. `vite-plugin-top-level-await` is retained per the Phase 07
// spec (and would transform any TLA introduced later); the worker currently
// initializes lazily on first message instead of via top-level await — see
// worker.ts for why (TLA broke message delivery in Vite dev module workers).
export default defineConfig({
  // `es2022` matches the app tsconfig `target: es2023`, is the right baseline
  // for a WASM + module-worker app, and avoids esbuild lowering errors that the
  // default `modules` target (safari14/es2020) raises on wasm-bindgen output.
  // GitHub Pages serves the site at a sub-path (github.io/composa/), so the
  // production build needs base: '/composa/'. Local dev keeps base '/' to avoid
  // a /composa/ prefix on localhost. GITHUB_ACTIONS is set in CI only.
  base: process.env.GITHUB_ACTIONS === 'true' ? '/composa/' : '/',
  build: { target: 'es2022' },
  plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
  worker: {
    // `format: 'es'` emits the worker as an ES module, matching
    // `new Worker(..., { type: 'module' })` in imageProcessor.ts. It also keeps
    // vite-plugin-top-level-await on its ES path (its worker-IIFE conversion is
    // incompatible with Vite 8's rolldown worker bundling).
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
})
