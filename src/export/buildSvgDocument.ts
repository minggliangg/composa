import type { CompositionState } from '../types/layer'
import { xmlEscapeAttr } from './xmlEscape'

/**
 * Options handed in by the orchestrator so the builder never reads the clock or
 * the environment itself — that is what keeps `buildSvgDocument` deterministic
 * and unit-testable (identical inputs always produce byte-identical output).
 */
export interface BuildOptions {
  /** ISO timestamp string (e.g. `new Date().toISOString()`). */
  timestamp: string
  /** App version string, embedded in the metadata block. */
  appVersion: string
  /** App name embedded in the metadata block. Defaults to `composa.`. */
  appName?: string
}

/**
 * How a single layer contributes to the exported document. `svg`/`blank`
 * resolve synchronously upstream in `exportComposition` (no WASM); the builder
 * just emits them.
 *   - `raster`: today's embedded `<image>`.
 *   - `blank`: a solid `<rect>` (a blank-base template).
 *   - `svg`: a nested `<svg>` body (`inner`, already id/class-namespaced) + its
 *     source `viewBox`, preserving vector fidelity.
 */
export type LayerSource =
  | { kind: 'raster'; dataUri: string }
  | { kind: 'svg'; inner: string; viewBox: string }
  | { kind: 'blank'; fill: string }

/**
 * Build a single self-contained SVG document string from canonical composition
 * state. PURE, synchronous, and deterministic: no DOM access, no async, no
 * `Date`/`Math.random` — the timestamp and version are passed in via `opts`.
 *
 * The SVG is assembled fresh from `state` (never by cloning the live editor
 * DOM). That guarantees no editor-only elements (selection handles, boundary
 * rect, preview-resolution `href`s) can leak into the exported file: only the
 * canonical per-layer element, in ascending z-index order, is emitted.
 *
 * Structure:
 *   <svg xmlns xmlns:xlink width height viewBox>
 *     <metadata>{ JSON: appName, appVersion, exportedAt, canvasW/H, layerCount }</metadata>
 *     <per layer, ascending z-index>:
 *       raster → <image href ... preserveAspectRatio="none" ... />
 *       blank  → <rect x y width height fill opacity ... />
 *       svg    → <svg x y width height viewBox preserveAspectRatio="none" opacity ...>inner</svg>
 *   </svg>
 *
 * @throws if `state.canvas` is null — the orchestrator must guard for "no base
 *   image" before calling. Throwing here keeps the contract explicit.
 */
export function buildSvgDocument(
  state: CompositionState,
  sources: Record<string, LayerSource>,
  opts: BuildOptions,
): string {
  const { canvas, layers } = state
  if (!canvas) {
    throw new Error('buildSvgDocument: state.canvas is null (no base image)')
  }

  const width = canvas.width
  const height = canvas.height

  // Metadata as a JSON blob inside <metadata>. It sits in element text content,
  // so only <, >, & are strictly required to be escaped — but reusing
  // xmlEscapeAttr (which also escapes quotes) is harmless because an XML
  // parser un-escapes them back when `.textContent` is read. Keeping a single
  // escape function avoids drift.
  const metadata = JSON.stringify({
    appName: opts.appName ?? 'composa.',
    appVersion: opts.appVersion,
    exportedAt: opts.timestamp,
    canvasWidth: width,
    canvasHeight: height,
    layerCount: layers.length,
  })

  // Ascending z-index == back-to-front paint order (base = 0 first).
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex)

  const layerLines = sorted.map((layer) => {
    const source = sources[layer.id] ?? { kind: 'blank', fill: '#ffffff' }
    const roleAttr = layer.isBaseImage ? ' data-role="base"' : ''
    const filenameAttr = ` data-filename="${xmlEscapeAttr(layer.originalFilename)}"`

    if (source.kind === 'raster') {
      // Embedded full-resolution image. Byte-identical to the pre-svg export.
      return (
        `  <image href="${xmlEscapeAttr(source.dataUri)}"` +
        ` x="${layer.x}"` +
        ` y="${layer.y}"` +
        ` width="${layer.width}"` +
        ` height="${layer.height}"` +
        ` opacity="${layer.opacity}"` +
        ` preserveAspectRatio="none"` +
        `${filenameAttr}` +
        `${roleAttr} />`
      )
    }

    if (source.kind === 'blank') {
      // A blank base: a literal solid rect (rasterizes correctly everywhere).
      return (
        `  <rect x="${layer.x}"` +
        ` y="${layer.y}"` +
        ` width="${layer.width}"` +
        ` height="${layer.height}"` +
        ` fill="${source.fill}"` +
        ` opacity="${layer.opacity}"` +
        `${filenameAttr}` +
        `${roleAttr} />`
      )
    }

    // svg: a nested <svg> body, namespaced upstream so duplicate ids can't collide.
    return (
      `  <svg x="${layer.x}"` +
      ` y="${layer.y}"` +
      ` width="${layer.width}"` +
      ` height="${layer.height}"` +
      ` viewBox="${source.viewBox}"` +
      ` preserveAspectRatio="none"` +
      ` opacity="${layer.opacity}"` +
      `${filenameAttr}` +
      `${roleAttr}>` +
      source.inner +
      `</svg>`
    )
  })

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    `  <metadata>${xmlEscapeAttr(metadata)}</metadata>\n` +
    layerLines.join('\n') +
    (layerLines.length > 0 ? '\n' : '') +
    `</svg>`
  )
}
