import { useCompositionStore } from '../state/compositionStore'
import { buildSvgDocument } from './buildSvgDocument'
import { resolveLayerSources } from './resolveSources'
import { collectFontFaces } from './fontEmbed'
import { downloadFile } from './downloadFile'

/**
 * Result of an export attempt. `ok: false` carries a stable machine-readable
 * `reason`; when the failure came from a WASM re-encode, `code` holds the
 * specific error code (e.g. `unsupported_format`) so the UI can map it to
 * user-facing copy via `wasmErrorMessage`.
 */
export type ExportResult =
  | { ok: true }
  | { ok: false; reason: 'no_base' | 'reencode_failed'; code?: string }

/** App metadata embedded in the exported SVG. */
export const APP_NAME = 'composa.'
export const APP_VERSION = '0.1.0'

/**
 * Export the current composition as one self-contained SVG at the base image's
 * full resolution.
 *
 * Flow:
 *   1. Guard: no base image -> `{ ok: false, reason: 'no_base' }`.
 *   2. Resolve EVERY layer's export source via `resolveLayerSources` (the seam
 *      shared with the WebP exporter): synchronous kinds pass through, rasters
 *      re-encode through the WASM worker (WeakMap-cached per File).
 *   3. If ANY layer fails to resolve, the whole export fails with
 *      `{ ok: false, reason: 'reencode_failed', code }` and NO file is
 *      downloaded — never produce a partial export.
 *   4. On success: build the SVG from state, trigger the download, return
 *      `{ ok: true }`.
 */
export async function exportComposition(): Promise<ExportResult> {
  const state = useCompositionStore.getState()

  const hasBase = state.layers.some((l) => l.isBaseImage)
  if (!hasBase || !state.canvas) {
    return { ok: false, reason: 'no_base' }
  }

  let sources
  try {
    sources = await resolveLayerSources(state)
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    return { ok: false, reason: 'reencode_failed', code: code || undefined }
  }

  // Embed the font faces a text layer needs (lazy woff2 fetch + base64). No text
  // layers -> [] -> no <defs> in the output.
  const fontFaces = await collectFontFaces(state.layers)

  const svg = buildSvgDocument(state, sources, {
    timestamp: new Date().toISOString(),
    appVersion: APP_VERSION,
    appName: APP_NAME,
    fontFaces,
  })

  downloadFile('composition.svg', new Blob([svg], { type: 'image/svg+xml' }))
  return { ok: true }
}
