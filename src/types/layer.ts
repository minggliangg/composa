/**
 * Core data model for composa. (Locked per MVP plan §3.)
 *
 * These types are the single source of truth the Zustand store, the live SVG
 * canvas, and the SVG exporter all read from / write through. They are fully
 * implemented here (not stubs) so every phase shares one contract.
 */

/**
 * Where a layer's full-resolution bytes live. Until WASM re-encoding lands
 * (Phase 07/08) uploads are held as the original `File`; after re-encoding the
 * normalized data URI is cached here for export.
 *
 * Two extra kinds resolve SYNCHRONOUSLY at export and never touch WASM:
 *   - `svg`: sanitized SVG markup (root guaranteed to carry a `viewBox`),
 *     embedded as a nested `<svg>` so vector fidelity survives the round trip.
 *   - `blank`: a solid fill (e.g. `#ffffff`) for a blank-base template,
 *     exported as a literal `<rect>` rather than an embedded image.
 *   - `text`: a styled text layer (Atkinson Hyperlegible Mono), rendered live on
 *     the canvas and embedded — font and all — in the export. (The `text` arm is
 *     added to this union in Step 6 alongside its store action.)
 *   - `rect`: a plain rectangle; today its only creation path is Frame
 *     selection — a transparent (`fill: null`) box whose `border` is the visible
 *     frame.
 */
export type FullResBytesRef =
  | { kind: 'file'; file: File }
  | { kind: 'reencoded'; dataUri: string }
  | { kind: 'svg'; markup: string; viewBox: string }
  | { kind: 'blank'; fill: string }
  | { kind: 'text'; text: TextContent }
  | { kind: 'rect'; fill: string | null }

/**
 * Payload of a text layer. All rendering geometry is derived PURELY from these
 * fields (the font is monospace, so metrics need no DOM measurement) — the
 * canvas and the exporter compute identical boxes/lines from `textMetrics.ts`
 * and can never drift.
 */
export interface TextContent {
  content: string
  fontSize: number
  /** Variable-axis weight, 200..800. */
  fontWeight: number
  italic: boolean
  /** Fill colour, `#rrggbb`. */
  fill: string
  align: 'left' | 'center' | 'right'
}

/**
 * A border painted OUTSIDE a layer's box (see `canvas/border.ts`). The stroke is
 * pushed outward so it never covers the enclosed asset — the only way to break
 * that is a negative `padding`, which the store clamps away in `normalizeBorder`.
 */
export interface LayerBorder {
  /** Stroke colour, a LITERAL `#rrggbb`. Never a `var(--…)` token: the export is
   *  standalone (same rule as a text layer's `fill`). */
  color: string
  /** Stroke thickness in CANVAS units. `<= 0` paints nothing. */
  width: number
  /** Gap between the asset edge and the border's inner edge. Always `>= 0`: a
   *  negative padding is the only way the border could cover the asset. */
  padding: number
}

/**
 * A single image layer (the base image or an overlay).
 *
 * Model-only fields (`rotation`, `visible`, `locked`) are present for later
 * phases but not exposed in the MVP UI; they default to 0 / true / false.
 */
export interface Layer {
  /** Stable identity, generated via `createLayerId()` (crypto.randomUUID). */
  id: string
  /** Original filename, verbatim and never mutated. Display dedup is computed. */
  originalFilename: string
  /**
   * User-editable display name, or `null` to fall back to the text first-line
   * (text layers) or `originalFilename`. Becomes the sanitized `id` attribute of
   * the exported SVG element (see `layerIds.ts`); the verbatim value is also
   * kept losslessly in `data-name`. Trims to `null` when blank.
   */
  name: string | null
  /** Declared MIME type (e.g. image/png). Authoritative format comes from WASM. */
  mimeType: string
  /** Object URL of the downscaled preview — the only thing ever rendered live. */
  previewUrl: string
  /** Full-resolution source, for export. */
  fullResBytesRef: FullResBytesRef
  /** Canvas-unit position of the layer's top-left corner. */
  x: number
  /** Canvas-unit position of the layer's top-left corner. */
  y: number
  /** Canvas-unit rendered width. */
  width: number
  /** Canvas-unit rendered height. */
  height: number
  /** Natural pixel width, for aspect-ratio math. */
  naturalWidth: number
  /** Natural pixel height, for aspect-ratio math. */
  naturalHeight: number
  /** Rotation in degrees. MODEL ONLY for MVP, always 0. */
  rotation: number
  /** Opacity, 0 (fully transparent) to 1 (fully opaque). Exported as-is. */
  opacity: number
  /** Dense int paint order; base image = 0. Array sorted by this IS SVG order. */
  zIndex: number
  /** Visibility. MODEL ONLY for MVP, always true. */
  visible: boolean
  /** Locked state. MODEL ONLY for MVP, always false. */
  locked: boolean
  /** Whether this layer is the composition's base image (sets canvas size). */
  isBaseImage: boolean
  /** Optional border painted OUTSIDE this layer's box (see `canvas/border.ts`).
   *  Absent = no border. Lives in `layers`, so zundo's `partialize` makes it
   *  undoable for free. */
  border?: LayerBorder
}

/** Canvas dimensions, equal to the base image's natural pixel size. */
export interface CanvasConfig {
  width: number
  height: number
}

/** The complete composition: canvas + ordered layers + selection + dirty flag. */
export interface CompositionState {
  canvas: CanvasConfig | null
  layers: Layer[]
  /** Selected layer ids in selection order; the LAST entry is the primary
   *  (anchor) edited by the properties form / targeted by resize handles. */
  selectedLayerIds: string[]
  /** Flips true on first mutation; drives the refresh-warning banner. */
  isDirty: boolean
}

/** Generate a stable layer id using the Web Crypto API. */
export function createLayerId(): string {
  return crypto.randomUUID()
}
