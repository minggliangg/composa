import { useCompositionStore } from '../state/compositionStore'
import { buildSvgDocument } from './buildSvgDocument'
import { resolveLayerSources } from './resolveSources'
import { collectFontFaces } from './fontEmbed'
import { downloadFile } from './downloadFile'
import {
  buildLayerManifest,
  serializeLayerManifest,
} from './layerManifest'
import { canEncodeWebp, rasterizeSvg } from './rasterize'
import type { RasterFormat } from './rasterize'
import { APP_NAME, APP_VERSION } from './exportComposition'

/**
 * Result of a WebP export attempt. Mirrors `ExportResult`, plus:
 *   - `format` on success — the ACTUAL encoded format. On browsers that cannot
 *     encode WebP (`canEncodeWebp() === false`, e.g. older Safari) the export
 *     transparently falls back to PNG (alpha still preserved) so the user
 *     always gets a raster + manifest pair; the UI surfaces the difference.
 *   - `manifestDownloaded` on success — whether `composition.json` was
 *     downloaded directly. Browsers gate a SECOND automatic download behind a
 *     per-site prompt once the click's transient activation has expired (the
 *     re-encode + rasterize chain above can outlive it on large
 *     compositions); a blocked prompt would silently swallow the file. When
 *     activation is no longer live, the manifest is NOT auto-downloaded —
 *     `manifestBlob` is returned instead so the UI can offer an explicit
 *     (gesture-backed, never-gated) follow-up click.
 *   - `reason: 'raster_failed'` — the built SVG could not be decoded or the
 *     canvas refused/didn't survive encoding (codes in `code`:
 *     `svg_decode_failed` / `canvas_too_large` / `canvas_blank` /
 *     `raster_encode_failed`).
 */
export type WebpExportResult =
  | {
      ok: true
      format: RasterFormat
      manifestDownloaded: boolean
      /** The manifest bytes; meaningful only when `manifestDownloaded` is false. */
      manifestBlob: Blob
    }
  | {
      ok: false
      reason: 'no_base' | 'reencode_failed' | 'raster_failed'
      code?: string
    }

/** Download names, mirroring `composition.svg`. Paired by the manifest. */
const IMAGE_FILENAME: Record<RasterFormat, string> = {
  'image/webp': 'composition.webp',
  'image/png': 'composition.png',
}
const MANIFEST_FILENAME = 'composition.json'

/**
 * Export the current composition as ONE flattened raster image (WebP where the
 * browser can encode it, PNG otherwise) at the canvas's full resolution, plus a
 * sibling JSON manifest describing every layer's coordinates and sizes in image
 * pixels (canvas units == pixels; the raster is rendered 1:1).
 *
 * Flow:
 *   1. Guard: no base image -> `{ ok: false, reason: 'no_base' }`.
 *   2. Resolve every layer's export source via the SAME `resolveLayerSources`
 *      seam the SVG exporter uses, then build the SAME self-contained SVG —
 *      the raster is literally a rasterization of the SVG export, so the two
 *      can never drift.
 *   3. Rasterize through an offscreen canvas (alpha preserved; a transparent
 *      blank base stays transparent).
 *   4. Build the manifest from the SAME state + sources (pure, deterministic),
 *      pointing `image.filename`/`mimeType` at the file actually downloaded.
 *   5. Download the image; download the manifest too when the export click's
 *      transient activation is still live (see `manifestDownloaded`), else
 *      return the manifest blob for a gesture-backed follow-up. A raster
 *      failure downloads NOTHING at all — never a partial pair.
 */
export async function exportWebp(): Promise<WebpExportResult> {
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

  const timestamp = new Date().toISOString()
  const svg = buildSvgDocument(state, sources, {
    timestamp,
    appVersion: APP_VERSION,
    appName: APP_NAME,
    fontFaces,
  })

  const format: RasterFormat = canEncodeWebp() ? 'image/webp' : 'image/png'

  let imageBlob: Blob
  try {
    imageBlob = await rasterizeSvg({
      svg,
      width: state.canvas.width,
      height: state.canvas.height,
      format,
    })
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    return { ok: false, reason: 'raster_failed', code: code || undefined }
  }

  const imageFilename = IMAGE_FILENAME[format]
  const manifest = buildLayerManifest(state, sources, {
    timestamp,
    appVersion: APP_VERSION,
    appName: APP_NAME,
    imageFilename,
    imageMimeType: format,
  })
  const manifestBlob = new Blob([serializeLayerManifest(manifest)], {
    type: 'application/json',
  })

  downloadFile(imageFilename, imageBlob)
  // Fire the manifest click ONLY while the export click's transient activation
  // is still live — a gesture-less second download is exactly what Chrome's
  // "multiple downloads" prompt gates, and a blocked prompt is undetectable
  // from JS. When activation has expired, hand the blob to the caller for an
  // explicit follow-up click instead (always gesture-backed, never gated).
  const manifestDownloaded = navigator.userActivation?.isActive === true
  if (manifestDownloaded) {
    downloadFile(MANIFEST_FILENAME, manifestBlob)
  }
  return { ok: true, format, manifestDownloaded, manifestBlob }
}
