# composa. — MVP Implementation Plan

## Context

We're building **composa.** — a single-page "image composition board": upload a base image, layer movable/resizable overlay images on top of it, and export the arrangement as a single self-contained SVG (base64-embedded images, filenames preserved as metadata, positions/dimensions/layer order preserved exactly). The working directory (`/Users/minggliangg/Projects/composa`) is currently completely empty — this is a greenfield build, not a modification of existing code.

The user specifically wants WASM incorporated into this SPA. Rather than force WASM into a place it doesn't help (drag math, SVG string building — both fast enough in plain JS), the natural fit is the one genuinely CPU-heavy part of this app: **image codec work**. A Rust/WASM module decodes uploads, produces a downscaled preview for smooth canvas interaction, and re-encodes the full-resolution original into the exported SVG — so the app stays fast to use but never loses quality on export. This also directly solves the spec's "very large images affecting performance" edge case rather than just noting it.

Local toolchain check: `cargo`/`rustc` and Node v24/npm 11 are present; `wasm-pack` is **not yet installed** (`cargo install wasm-pack` is a setup step in M1/M7).

## Decisions locked in (confirmed with user, not open for re-litigation)

| Area         | Decision                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Stack        | React + TypeScript + Vite                                                                                        |
| WASM role    | Rust module: decode + downscale for canvas preview; re-encode full-res original as base64 at export time         |
| Canvas       | Live `<svg>` DOM (not HTML/CSS divs, not `<canvas>` bitmap) — export = build the same structure fresh from state |
| Large images | Handled by the WASM downscale/full-res split above, run off the main thread in a Web Worker                      |
| Styling      | Tailwind CSS                                                                                                     |
| Deployment   | Static hosting only, no backend                                                                                  |
| Persistence  | None in MVP — refresh loses work, communicated clearly in UI                                                     |
| Rotation     | Deferred from UI; field stays in the data model for later                                                        |

MVP scope (from the product discussion): base upload, multi-overlay upload, drag-to-position, corner/edge resize handles (aspect-ratio-preserving on corners), layer ordering, select/delete, filename display, reset/clear, SVG export preserving filenames/positions/dimensions/layer order/base placement. **Out of scope for v1** (data model leaves room, UI does not expose): rotation, lock/visibility toggles, cropping, snapping, undo/redo, multi-select, persistence.

---

## 1. Project Structure

```
composa/
├── crates/image-processor/        # Rust/WASM crate (cdylib)
│   ├── Cargo.toml
│   └── src/lib.rs                 # wasm-bindgen exports
├── src/
│   ├── main.tsx / App.tsx
│   ├── wasm/imageProcessor.ts     # typed wrapper + Web Worker proxy around crates/image-processor/pkg
│   ├── wasm/worker.ts             # Web Worker: re-inits wasm module, runs decode/reencode off main thread
│   ├── types/layer.ts             # Layer, CanvasConfig, CompositionState types
│   ├── state/compositionStore.ts  # Zustand store — single source of truth
│   ├── canvas/
│   │   ├── CompositionCanvas.tsx  # the live <svg>
│   │   ├── LayerImage.tsx, SelectionOverlay.tsx, ResizeHandle.tsx
│   │   ├── useCanvasPointer.ts    # pointer-event drag/resize hook
│   │   └── coords.ts              # screen ↔ canvas-unit coordinate math (SVG CTM-based)
│   ├── panels/LeftPanel/ (UploadDropzone, LayerList, LayerListItem)
│   ├── panels/RightPanel/ (PropertiesForm)
│   ├── panels/TopBar.tsx          # export, reset/clear, dirty/unsaved-data banner
│   ├── export/buildSvgDocument.ts, xmlEscape.ts, downloadFile.ts
│   └── upload/fileValidation.ts, filenameDisplay.ts
├── tests/unit/ (Vitest), tests/e2e/ (Playwright)
└── scripts/build-wasm.sh
```

Build wiring: `wasm-pack build crates/image-processor --target web --release --out-dir ../../src/wasm/pkg` runs before `vite`/`vite build` (npm scripts `dev`/`build` both call it first). `--target web` gives a self-initializing ES module that `vite-plugin-wasm` + `vite-plugin-top-level-await` can import directly with no bundler-specific resolution assumptions. Generated `pkg/` is git-ignored; only the hand-written `imageProcessor.ts` wrapper is committed.

## 2. WASM Module Design (`crates/image-processor/src/lib.rs`)

Dependencies: `wasm-bindgen`, `image` (features trimmed to PNG/JPEG/GIF/WebP only — deliberately not a general image-processing platform), `base64`, `console_error_panic_hook` (dev only).

Exported functions (plain types across the boundary — no shared structs):

```rust
pub fn init_panic_hook();
pub fn probe_dimensions(bytes: &[u8]) -> Result<js_sys::Array /* [w,h] */, JsValue>;
pub fn decode_and_downscale(bytes: &[u8], max_dim: u32) -> Result<Vec<u8>, JsValue>; // -> PNG bytes
pub fn reencode_original(bytes: &[u8]) -> Result<String, JsValue>; // -> "data:image/..;base64,.." string
```

- Errors are short machine-readable codes (`"unsupported_format"`, `"decode_failed"`, `"dimensions_too_large"`) mapped to user-facing copy in the JS wrapper — decoupled from `image` crate's own error text.
- Format support relies entirely on the `image` crate's magic-byte sniffing (`image::load_from_memory`) — no hand-rolled detection. Animated GIF explicitly plays first-frame-only (noted, not solved).
- No threading/SIMD/rayon — single-threaded sync functions. The main-thread-blocking risk on large images is solved by running these calls inside a **Web Worker** (`src/wasm/worker.ts`, which does its own `await init()` since WASM instances aren't transferable), not by WASM-internal parallelism. `imageProcessor.ts` exposes `async decodeAndDownscale(file, maxDim): Promise<Blob>` etc. on the main thread, proxying via `postMessage`.
- `reencode_original` always re-encodes (not raw-passthrough of the upload) — normalizes format, preserves alpha for transparent PNGs, strips EXIF/ICC bloat.
- `MAX_SOURCE_DIMENSION` constant (e.g. 12000px) checked in `probe_dimensions`/`decode_and_downscale`, returns `"dimensions_too_large"` rather than hanging on a pathological input.

## 3. Data Model & State Management

```typescript
export interface Layer {
  id: string; // crypto.randomUUID()
  originalFilename: string; // verbatim, never mutated — display dedup is computed separately
  mimeType: string;
  previewUrl: string; // object URL, WASM-downscaled preview — only thing ever rendered live
  fullResBytesRef:
    | { kind: "file"; file: File }
    | { kind: "reencoded"; dataUri: string };
  x: number;
  y: number;
  width: number;
  height: number; // canvas units
  naturalWidth: number;
  naturalHeight: number; // for aspect-ratio math
  rotation: number; // MODEL ONLY for MVP, default 0
  zIndex: number; // dense int, base image = 0 — array order sorted by this IS SVG paint order
  visible: boolean; // MODEL ONLY for MVP, always true
  locked: boolean; // MODEL ONLY for MVP, always false
  isBaseImage: boolean;
}
export interface CanvasConfig {
  width: number;
  height: number;
} // = base image's natural pixel size
export interface CompositionState {
  canvas: CanvasConfig | null;
  layers: Layer[];
  selectedLayerId: string | null;
  isDirty: boolean;
}
```

**State library: Zustand**, not Context+useReducer. Rationale: drag/resize needs high-frequency updates to one specific layer's transform; Zustand's selector-based subscriptions (`useStore(s => s.layers.find(l => l.id === id))`) let only the affected component re-render, without hand-building a per-layer Context provider tree. Centralized named actions (`addOverlay`, `updateLayerTransform`, `reorderLayer`, `deleteLayer`, `resetComposition`, ...) keep a clean seam for a future undo middleware even though undo/redo itself is out of scope.

`isDirty` flips true on first mutation, drives the refresh-warning banner and `beforeunload` handler.

## 4. SVG Canvas Interaction

`viewBox="0 0 canvas.width canvas.height"` = base image's natural pixel dimensions. Screen ↔ canvas-unit conversion goes through the SVG's own CTM (`svg.getScreenCTM().inverse()` via `createSVGPoint().matrixTransform(...)`) rather than hand-deriving scale from `getBoundingClientRect()` — stays correct under any `preserveAspectRatio` letterboxing.

- **Selection**: click a layer's `<g>` → `selectLayer(id)`; click a transparent background `<rect>` → deselect.
- **Drag**: pointer events (not mouse events) with `setPointerCapture`; delta computed in canvas units between pointerdown and pointermove, applied to the layer's recorded starting `x/y`.
- **Resize**: 8 handles. **Corner handles preserve aspect ratio** (anchor = opposite corner, dominant-axis-drives-the-other formula, `MIN_LAYER_SIZE` floor); **edge handles do single-axis free resize** — this is the concrete interpretation of "corner or edge handles, preserving aspect ratio by default" since MVP has no modifier-key toggle.
- **Layer order**: `zIndex` dense-int per layer; canvas renders `[...layers].sort(by zIndex)` — array order directly is SVG paint order, no separate concept needed. Reordering in the layer list renumbers the affected range.
- **Off-canvas dragging**: deliberately **not clamped** — `x`/`y`/`x+width` can exceed canvas bounds (matches Figma/Photoshop convention). A dashed boundary `<rect>` gives visual feedback; the SVG is not clipped in the editor (more honest — shows what's hanging off). At **export**, standard SVG viewport clipping handles cropping automatically — no special export-time code needed.

## 5. Component Breakdown

Three-panel layout: `TopBar` (export / reset·clear with confirm / dirty banner) above a grid of `LeftPanel` (upload dropzones + `LayerList`/`LayerListItem` with dedup'd filename, select, delete-with-confirm, drag-to-reorder) — `CompositionCanvas` (the `<svg>`: background rect, boundary rect, `LayerImage`s sorted by zIndex, `SelectionOverlay` with `ResizeHandle`s for the selected layer) — `RightPanel` (`PropertiesForm`: filename read-only, x/y/width/height numeric inputs that write through the _same_ `updateLayerTransform` action as canvas drag/resize, so the two surfaces can't drift). A single shared `ConfirmDialog` backs delete/reset/clear.

## 6. SVG Export (`export/buildSvgDocument.ts`)

1. Guard: no base image → Export disabled.
2. Resolve every layer's full-res data URI in parallel via the Worker-proxied `reencode_original` (cache per-session once resolved). If any layer fails, **fail the whole export** with one clear error rather than silently produce a partial file — simplest correct MVP behavior.
3. Build the SVG string fresh from `CompositionState` (not by cloning the live DOM — the live DOM has editor-only elements like selection handles and preview-resolution hrefs that would need stripping; building from canonical state avoids ever exporting something stale):
   - `<svg viewBox="0 0 W H" width="W" height="H">` at the base image's natural dimensions
   - `<metadata>` block: canvas size, export timestamp, layer count, app name (`composa.`)/version
   - One `<image href="data:...;base64,..." data-filename="..." x=".." y=".." width=".." height=".." preserveAspectRatio="none" />` per layer in zIndex order (base image tagged `data-role="base"`)
4. `xmlEscapeAttr()` applied to every filename (and defensively to the data URI) — escapes `& < > " '`. Directly solves the "filename characters needing escaping" edge case.
5. Download via `Blob` → object URL → temporary `<a download>` click → revoke. No backend involved.

## 7. Edge Case Handling

| Edge case                   | Handling                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate filenames         | `originalFilename` never used as a key (id/UUID is); display label computed on the fly with `(n)` suffixes for collisions                                                           |
| Very large images           | WASM decode/downscale/reencode run in a Web Worker off the main thread; canvas only ever shows the downscaled preview; `MAX_SOURCE_DIMENSION` guard rejects pathological inputs     |
| Unsupported file types      | Cheap client-side extension/MIME pre-check for fast feedback; authoritative gate is the WASM `Result::Err("unsupported_format")` from real format sniffing (MIME/extension can lie) |
| Transparent PNG overlays    | `image` crate preserves alpha through downscale and re-encode; SVG `<image>` renders it natively — verify manually in M7/M8                                                         |
| Overlays dragged off-canvas | Not clamped in the model; dashed boundary rect for visual feedback; standard SVG viewport clipping handles it at export automatically                                               |
| Accidental deletion         | Shared `ConfirmDialog` on delete and reset/clear — no full undo/redo needed for this                                                                                                |
| Refresh before export       | `isDirty`-driven `beforeunload` native prompt + persistent "not saved" banner in `TopBar`                                                                                           |
| Unusual export formats      | `reencode_original` always normalizes actual bytes to match the declared embedded MIME — never trusts the original upload's self-reported type                                      |
| Filename XML escaping       | `xmlEscapeAttr()` on every `data-filename`                                                                                                                                          |
| Cropping vs resizing        | MVP always stretches (`preserveAspectRatio="none"`); model leaves room for a future `cropRect` field, no crop UI built now                                                          |

## 8. Milestones

1. **M1 — Scaffold**: Vite+React+TS+Tailwind, static 3-panel layout, git init.
2. **M2 — Base image only**: Zustand store, base upload (plain `Image()` decode, no WASM yet) sets canvas size, renders in SVG.
3. **M3 — Overlay upload, static placement**: multi-upload, default-positioned, stacked, non-interactive.
4. **M4 — Select + drag**: pointer handlers, CTM-based coord conversion, full drag-to-move including off-canvas.
5. **M5 — Resize handles**: 8 handles, corner aspect-preserving / edge free-resize math.
6. **M6 — Layer list, reorder, delete, properties panel**: full non-WASM MVP loop working end to end except export.
7. **M7 — WASM integrated**: `wasm-pack` scaffold, Worker wrapper, swap in `decode_and_downscale`/`probe_dimensions`, panic hook, `MAX_SOURCE_DIMENSION` guard, unsupported-format errors.
8. **M8 — SVG export**: `reencode_original` wired in, `buildSvgDocument`, download flow, metadata block. _Verify by opening the exported file directly in a browser._
9. **M9 — Edge-case hardening**: refresh-warning UX, dedup display labels, transparent-PNG check, off-canvas boundary polish, walk every row of the edge-case table live.

_Option:_ since the WASM pipeline is the least-familiar part of the stack, consider a throwaway WASM spike in parallel with M1–M2 to de-risk `wasm-pack`/`vite-plugin-wasm` wiring before committing to the M7 sequencing above.

## 9. Testing Strategy

- **Unit (Vitest)**: store actions (add/select/delete/reorder/reset — pure state transitions), resize/move math as extracted pure functions (table-tested corner/edge/clamp cases), `xmlEscapeAttr`, `buildSvgDocument` (deterministic string/DOM-parsed assertions against a fixed mock state), `filenameDisplay` dedup logic, `fileValidation`.
- **E2E (Playwright)**: real pointer drag/resize against the rendered SVG (jsdom can't do real CTM/layout), multi-file upload flow, full export round-trip (hook the download event, parse the blob as XML, assert structure — this can be scripted, not just eyeballed).
- **Manual**: transparent-PNG visual fidelity, large-image main-thread-responsiveness (DevTools performance profiling), `beforeunload` native dialog (flaky to script reliably across browsers).
- **Build pipeline**: a CI step running `wasm-pack build` to catch Rust compile errors is the right place to validate the WASM module builds — not a JS-side unit test faking it.

## Critical files to implement first

- `crates/image-processor/src/lib.rs` — the entire WASM contract; everything else's export quality depends on this.
- `src/state/compositionStore.ts` — single source of truth all UI reads/writes through.
- `src/canvas/coords.ts` + `src/canvas/useCanvasPointer.ts` — coordinate math that makes SVG-native drag/resize work at all.
- `src/export/buildSvgDocument.ts` — determines whether the output file actually matches spec.
- `vite.config.ts` — `vite-plugin-wasm` + `vite-plugin-top-level-await` wiring; misconfiguration blocks M7/M8 entirely.

## Verification

- After each milestone (M1–M9), run `npm run dev` and manually exercise that milestone's demo criteria (listed above) in a real browser.
- After M8, open the exported `.svg` file directly in a browser and confirm it renders identically to the live canvas at full resolution; inspect `data-filename` attributes for correct XML-escaping on a filename with special characters (e.g. `photo & friends.png`).
- Run `npm run build` (which chains `wasm-pack build` then `vite build`) to confirm the production build succeeds — this is the point where WASM/Vite integration issues surface.
- Run the Vitest suite (`npx vitest run`) and Playwright suite (`npx playwright test`) once M6–M8 land.
