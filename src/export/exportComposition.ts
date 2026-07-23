import { useCompositionStore } from '../state/compositionStore'
import { reencodeOriginal } from '../wasm/imageProcessor'
import { buildSvgDocument } from './buildSvgDocument'
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
 *   2. Resolve EVERY layer's full-res data URI. `{ kind: 'reencoded' }` layers
 *      use their cached URI; `{ kind: 'file' }` layers are re-encoded via the
 *      WASM worker (with a WeakMap cache so a re-export never re-encodes). All
 *      resolutions run in parallel.
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

  // Resolve every layer's full-resolution data URI in parallel. A rejection in
  // any single entry rejects the whole `Promise.all`, which is exactly the
  // "fail the whole export" semantics we want.
  let dataUris: Record<string, string>
  try {
    const entries = await Promise.all(
      state.layers.map(async (layer) => {
        const ref = layer.fullResBytesRef
        let uri: string
        if (ref.kind === 'reencoded') {
          uri = ref.dataUri
        } else {
          const cached = fullResCache.get(ref.file)
          if (cached !== undefined) {
            uri = cached
          } else {
            uri = await reencodeOriginal(ref.file)
            fullResCache.set(ref.file, uri)
          }
        }
        return [layer.id, uri] as const
      }),
    )
    dataUris = Object.fromEntries(entries)
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    return { ok: false, reason: 'reencode_failed', code: code || undefined }
  }

  const svg = buildSvgDocument(state, dataUris, {
    timestamp: new Date().toISOString(),
    appVersion: APP_VERSION,
    appName: APP_NAME,
  })

  downloadFile('composition.svg', new Blob([svg], { type: 'image/svg+xml' }))
  return { ok: true }
}
