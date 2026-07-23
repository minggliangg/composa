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
 */
export type FullResBytesRef =
  | { kind: 'file'; file: File }
  | { kind: 'reencoded'; dataUri: string }

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
  selectedLayerId: string | null
  /** Flips true on first mutation; drives the refresh-warning banner. */
  isDirty: boolean
}

/** Generate a stable layer id using the Web Crypto API. */
export function createLayerId(): string {
  return crypto.randomUUID()
}
