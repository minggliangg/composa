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
 * Build a single self-contained SVG document string from canonical composition
 * state. PURE, synchronous, and deterministic: no DOM access, no async, no
 * `Date`/`Math.random` — the timestamp and version are passed in via `opts`.
 *
 * The SVG is assembled fresh from `state` (never by cloning the live editor
 * DOM). That guarantees no editor-only elements (selection handles, boundary
 * rect, preview-resolution `href`s) can leak into the exported file: only the
 * canonical `<image>` per layer, in ascending z-index order, is emitted.
 *
 * Structure:
 *   <svg xmlns xmlns:xlink width height viewBox>
 *     <metadata>{ JSON: appName, appVersion, exportedAt, canvasW/H, layerCount }</metadata>
 *     <image href data-filename x y width height preserveAspectRatio="none" [data-role="base"] />
 *     ...
 *   </svg>
 *
 * @throws if `state.canvas` is null — the orchestrator must guard for "no base
 *   image" before calling. Throwing here keeps the contract explicit.
 */
export function buildSvgDocument(
  state: CompositionState,
  dataUris: Record<string, string>,
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

  const imageLines = sorted.map((layer) => {
    const uri = dataUris[layer.id] ?? ''
    const roleAttr = layer.isBaseImage ? ' data-role="base"' : ''
    return (
      `  <image href="${xmlEscapeAttr(uri)}"` +
      ` x="${layer.x}"` +
      ` y="${layer.y}"` +
      ` width="${layer.width}"` +
      ` height="${layer.height}"` +
      ` preserveAspectRatio="none"` +
      ` data-filename="${xmlEscapeAttr(layer.originalFilename)}"` +
      `${roleAttr} />`
    )
  })

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    `  <metadata>${xmlEscapeAttr(metadata)}</metadata>\n` +
    imageLines.join('\n') +
    (imageLines.length > 0 ? '\n' : '') +
    `</svg>`
  )
}
