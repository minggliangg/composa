# composa.

**An image composition board for the browser.** Upload a base image, layer movable / resizable overlays on top of it, and export the whole arrangement as a single self-contained SVG — images base64-embedded, filenames, positions, dimensions and layer order all preserved exactly.

🔗 **Live demo:** <https://mingliangg.com/composa/>

---

## Highlights

- **Layered composition** — one base image defines the canvas; add as many overlays as you like.
- **Direct manipulation** — click to select, drag to move, 8 resize handles (corners preserve aspect ratio, edges resize one axis). Works in real SVG coordinate space, so it stays correct under any letterboxing.
- **Off-canvas friendly** — drag layers beyond the canvas edge (Figma/Photoshop style); a dashed boundary shows the export crop, and standard SVG viewport clipping handles the rest at export.
- **Text layers** — add live, editable text in Atkinson Hyperlegible Mono; control size, weight, italic, fill, and alignment. The font is embedded (base64 `@font-face`) right inside the exported SVG, so text renders identically reopened in any browser.
- **Layer names** — rename any layer in the list or the properties panel; the name becomes the exported element's `id`, with the original filename preserved as `data-filename`.
- **Alignment guides** — hold **Alt/Option** while dragging to snap a layer's edges/centre to other layers or the canvas, with live guide lines. (A status-bar toggle inverts the default for window managers that grab Alt.)
- **WASM image pipeline** — a Rust/WebAssembly module (running in a Web Worker, off the UI thread) decodes uploads, builds downscaled previews for smooth editing, and re-encodes the full-resolution original at export. Large images never block the UI, and quality is never lost on export.
- **Faithful SVG export** — one file, no external assets. Transparent PNGs keep their alpha, filenames with special characters are XML-escaped, and the output opens identically in any browser.
- **No backend, no tracking** — a static SPA. (There's also no persistence in this MVP: refresh loses your work, so use Export to save.)

## How it works

The editor is a live `<svg>` DOM whose `viewBox` is the base image's natural pixel size. All state (layers, selection, transforms) lives in a single Zustand store — the canvas, the properties panel, and the exporter all read from and write through it, so the surfaces can never drift.

The genuinely CPU-heavy part — image codec work — is the natural home for WASM here. A Rust crate (`crates/image-processor`) provides three operations:

| Export | Purpose |
| --- | --- |
| `probe_dimensions` | Magic-byte format sniff + natural size |
| `decode_and_downscale` | Downscaled PNG preview (never upscales, alpha preserved) |
| `reencode_original` | Full-res PNG data URI for the exported SVG |

These run inside a **Web Worker** (`src/wasm/worker.ts`), which owns its own WASM instance (instances aren't transferable across threads). The main thread talks to it through a typed `postMessage` proxy. Drag math, resize math, and SVG string building stay in plain JS — they're fast enough and don't benefit from WASM.

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | React 19 + TypeScript |
| Build | Vite 8 |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Image processing | Rust + `wasm-bindgen`, compiled with `wasm-pack` (`--target web`) |
| Unit tests | Vitest (jsdom) |
| E2E tests | Playwright |
| Package manager | Bun |

## Project structure

```
composa/
├── crates/image-processor/     # Rust/WASM crate (cdylib): decode, downscale, re-encode
│   └── src/lib.rs
├── scripts/build-wasm.sh       # wasm-pack build → src/wasm/pkg (generated, git-ignored)
├── src/
│   ├── canvas/                 # live <svg>: CompositionCanvas, LayerImage, SelectionOverlay,
│   │                           #   ResizeHandle, coords (CTM math), useCanvasPointer, resize (pure math)
│   ├── state/                  # Zustand composition store (single source of truth)
│   ├── panels/                 # TopBar, LeftPanel (upload + layer list), RightPanel (properties)
│   ├── export/                 # buildSvgDocument, exportComposition, xmlEscape, downloadFile,
│   │                           #   layerIds (exported id sanitising), fontEmbed (embedded @font-face)
│   ├── text/                   # textMetrics (pure monospace metrics + layout, shared by canvas + export)
│   ├── upload/                 # fileValidation, filenameDisplay (dedup + display labels), errorMessages
│   ├── wasm/                   # imageProcessor (main-thread proxy) + worker.ts (owns the WASM)
│   └── types/layer.ts          # Layer / CanvasConfig / CompositionState / TextContent
├── licenses/                   # vendored third-party licences (Atkinson Hyperlegible Mono — OFL-1.1)
├── tests/unit/                 # Vitest — store, coords, drag, resize, export, validation, …
├── tests/e2e/                  # Playwright — real drag/resize/upload/export flows
└── docs/                       # MVP plan, phase specs, edge-case verification
```

## Getting started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Rust](https://rustup.rs) (stable) + the `wasm32-unknown-unknown` target
- [`wasm-pack`](https://rustwasm.github.io/wasm-pack/installer/) (`cargo install wasm-pack` or the installer script)

### Install & run

```bash
bun install          # JS dependencies
bun run dev          # builds the WASM module, then serves on http://localhost:5173
bun run build        # wasm-pack build → tsc → vite build (output in dist/)
bun run preview      # preview the production build
```

`dev` and `build` both compile the WASM crate first (via `scripts/build-wasm.sh`), so the generated `src/wasm/pkg/` is always present. That directory is git-ignored — it's a build artifact.

## Testing

```bash
bun run test         # Vitest unit suite (pure math, store, export, validation)
bun run test:e2e     # Playwright in real Chromium (upload, drag, resize, controls, export)
```

The trickiest logic (coordinate conversion, drag deltas, all 8 resize handles with aspect/MIN-floor behavior, the SVG builder) is extracted into pure, table-driven unit tests. E2E tests exercise the real browser path — including the WASM worker — end to end through export.

## Notes & non-goals (MVP)

- **No persistence** — refreshing the page loses your work. An `isDirty` banner and a native `beforeunload` guard warn you; use **Export** to save an SVG.
- **Rotation, lock/visibility toggles, cropping, undo/redo, multi-select** are intentionally out of scope (the data model leaves room for some of them).
- **Animated GIFs** are treated as first-frame-only.
- Export always **stretches** layers to their recorded box (`preserveAspectRatio="none"`); the model leaves room for a future crop rect.

## Third-party assets

**Atkinson Hyperlegible Mono** (variable font) is bundled for text layers and
base64-embedded inside exported SVGs. It is © 2020–2024 The Atkinson Hyperlegible
Mono Project Authors, licensed under the **SIL Open Font License 1.1**. The
verbatim licence (including the copyright line) is vendored at
[`licenses/Atkinson-Hyperlegible-Mono-OFL.txt`](licenses/Atkinson-Hyperlegible-Mono-OFL.txt),
and every exported SVG that embeds the font repeats the notice in an XML comment
plus the `<metadata>` block. No Reserved Font Name is declared, so the family
name is used unaltered.

> **Font-fidelity caveat.** The embedded `@font-face` is honoured by browsers
> (Chrome/Firefox/Safari) but ignored by many non-browser rasterizers (resvg /
> usvg, librsvg; Inkscape is unreliable), which resolve `font-family` against a
> *system* font database. Two mitigations are baked in: a `ui-monospace,
> monospace` fallback in the font stack, and explicit `x`/`y` on every `<tspan>`
> (rather than `dy`) so a fallback font may change glyph shapes but can never
> reflow line positions. Outlining glyphs to `<path>` for full portability (e.g.
> via opentype.js) is out of scope for this iteration.

## License

MIT.
