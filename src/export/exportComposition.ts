import { useCompositionStore } from '../state/compositionStore'
import { reencodeOriginal } from '../wasm/imageProcessor'
import { buildSvgDocument } from './buildSvgDocument'
import type { LayerSource } from './buildSvgDocument'
import { namespaceSvgMarkup } from './svgNamespace'
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

/**
 * Per-session cache of resolved full-resolution data URIs, keyed by the
 * original `File`. A `WeakMap` is used deliberately:
 *   - it avoids touching the locked composition store (the cache lives outside
 *     state, as the plan requires "cache per-session once resolved");
 *   - entries are reclaimed automatically when a File is dropped (e.g. after a
 *     reset/clear), so the cache cannot grow unbounded across a long session.
 *
 * Only layers with `fullResBytesRef.kind === 'file'` go through `reencode`;
 * layers already holding a `{ kind: 'reencoded'; dataUri }` use that URI
 * directly (the store is the source of truth for those).
 */
const fullResCache = new WeakMap<File, string>()

/** App metadata embedded in the exported SVG. */
const APP_NAME = 'composa.'
const APP_VERSION = '0.1.0'

/**
 * Export the current composition as one self-contained SVG at the base image's
 * full resolution.
 *
 * Flow:
 *   1. Guard: no base image -> `{ ok: false, reason: 'no_base' }`.
 *   2. Resolve EVERY layer's export source. `{ kind: 'svg' }` layers are
 *      id/class-namespaced (synchronous, prefix = sorted index `L<n>`); blank
 *      layers pass through; `{ kind: 'reencoded' }` use their cached URI;
 *      `{ kind: 'file' }` layers are re-encoded via the WASM worker (with a
 *      WeakMap cache so a re-export never re-encodes). All resolutions run in
 *      parallel — only rasters can reject.
 *   3. If ANY layer fails to resolve, the whole export fails with
 *      `{ ok: false, reason: 'reencode_failed', code }` and NO file is
 *      downloaded — never produce a partial SVG.
 *   4. On success: build the SVG from state, trigger the download, return
 *      `{ ok: true }`.
 */
export async function exportComposition(): Promise<ExportResult> {
  const state = useCompositionStore.getState()

  const hasBase = state.layers.some((l) => l.isBaseImage)
  if (!hasBase || !state.canvas) {
    return { ok: false, reason: 'no_base' }
  }

  // Resolve every layer's export source in parallel. `svg`/`blank` resolve
  // synchronously (no WASM, no cache); only `file`/`reencoded` rasters can
  // reject. A rejection in any single entry rejects the whole `Promise.all`,
  // which is exactly the "fail the whole export" semantics we want.
  //
  // The svg id/class namespace prefix is the layer's SORTED (z-index) index
  // `L0`, `L1`, … — NOT layer.id — so the emitted bytes stay deterministic.
  const sorted = [...state.layers].sort((a, b) => a.zIndex - b.zIndex)
  const sortedIndex = new Map(sorted.map((l, i) => [l.id, i] as const))

  let sources: Record<string, LayerSource>
  try {
    const entries = await Promise.all(
      state.layers.map(async (layer) => {
        const ref = layer.fullResBytesRef
        let source: LayerSource
        if (ref.kind === 'reencoded') {
          source = { kind: 'raster', dataUri: ref.dataUri }
        } else if (ref.kind === 'svg') {
          const ns = namespaceSvgMarkup(
            ref.markup,
            'L' + (sortedIndex.get(layer.id) ?? 0),
          )
          source = { kind: 'svg', inner: ns.inner, viewBox: ns.viewBox }
        } else if (ref.kind === 'blank') {
          source = { kind: 'blank', fill: ref.fill }
        } else {
          const cached = fullResCache.get(ref.file)
          if (cached !== undefined) {
            source = { kind: 'raster', dataUri: cached }
          } else {
            const uri = await reencodeOriginal(ref.file)
            fullResCache.set(ref.file, uri)
            source = { kind: 'raster', dataUri: uri }
          }
        }
        return [layer.id, source] as const
      }),
    )
    sources = Object.fromEntries(entries)
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    return { ok: false, reason: 'reencode_failed', code: code || undefined }
  }

  const svg = buildSvgDocument(state, sources, {
    timestamp: new Date().toISOString(),
    appVersion: APP_VERSION,
    appName: APP_NAME,
  })

  downloadFile('composition.svg', new Blob([svg], { type: 'image/svg+xml' }))
  return { ok: true }
}
