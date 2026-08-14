import type { CompositionState, Layer, LayerBorder } from '../types/layer'
import type { LayerSource } from './buildSvgDocument'
import { assignLayerIds } from './layerIds'
import { layerDisplayLabel } from '../upload/filenameDisplay'

/**
 * The JSON manifest that accompanies a raster (WebP) export: where every layer
 * sits on the canvas, in the same coordinate system as the image's pixels
 * (canvas units ARE image pixels — the raster is rendered at `canvas` size).
 *
 * PURE and deterministic, mirroring `buildSvgDocument`: no DOM, no clock — the
 * timestamp/version arrive via `opts`, and identical inputs produce
 * byte-identical JSON (`serializeLayerManifest`). The canvas renders geometry
 * and this file describes it; the two are built from the SAME state + sources
 * in the same call, so they can never disagree.
 */

/** The manifest schema version. Bump on breaking shape changes. */
export const MANIFEST_FORMAT = 'composa.manifest/1'

/** A layer's border, verbatim from the model (already normalized at the seam). */
export interface ManifestBorder {
  color: string
  width: number
  padding: number
}

/** One layer's geometry + identity in the manifest. */
export interface ManifestLayer {
  /** The store's stable layer id (UUID) — the layer's identity across sessions. */
  id: string
  /** The NCName `id` of the layer's element in the exported SVG, so a consumer
   *  holding both files can cross-reference manifest row <-> SVG element. */
  exportId: string
  /** Display label via the SAME `layerDisplayLabel` chain the exported SVG ids
   *  derive from (custom name -> text first line -> filename), so manifest
   *  names and SVG ids always agree. */
  name: string
  /** Original filename, verbatim. */
  filename: string
  /** The resolved source kind — how the layer's pixels were produced. */
  kind: LayerSource['kind']
  /** Canvas-unit position of the layer's top-left corner (== image pixels). */
  x: number
  y: number
  /** Canvas-unit rendered size (== image pixels). NOTE: the layer's own box —
   *  a border (when present) lies OUTSIDE it, offset by `border.padding`. */
  width: number
  height: number
  /** Rotation in degrees (model field; always 0 today). */
  rotation: number
  /** Opacity, 0..1 — as painted into the image. */
  opacity: number
  /** Dense paint order; ascending in `layers` == back-to-front. */
  zIndex: number
  /** Whether this layer is the composition's base (defines the canvas). */
  isBase: boolean
  /** Blank/rect layers only: the fill colour, or `null` for transparent. */
  fill?: string | null
  /** Present only when the layer carries a border. */
  border?: ManifestBorder
}

/** The complete manifest document. */
export interface LayerManifest {
  format: typeof MANIFEST_FORMAT
  generator: { name: string; version: string }
  exportedAt: string
  canvas: { width: number; height: number }
  /** The sibling raster file this manifest describes. */
  image: {
    filename: string
    mimeType: string
    width: number
    height: number
  }
  /** Ascending z-index == back-to-front paint order (base first). */
  layers: ManifestLayer[]
}

/** Options handed in by the orchestrator (same discipline as `BuildOptions`). */
export interface ManifestOptions {
  /** ISO timestamp string. */
  timestamp: string
  appVersion: string
  /** Defaults to `composa.`. */
  appName?: string
  /** The raster file's name as downloaded (e.g. `composition.webp`). */
  imageFilename: string
  /** The raster file's MIME type (e.g. `image/webp`). */
  imageMimeType: string
}

function manifestBorder(b: LayerBorder): ManifestBorder {
  return { color: b.color, width: b.width, padding: b.padding }
}

function manifestLayer(
  layer: Layer,
  source: LayerSource,
  exportId: string,
): ManifestLayer {
  const entry: ManifestLayer = {
    id: layer.id,
    exportId,
    name: layerDisplayLabel(layer),
    filename: layer.originalFilename,
    kind: source.kind,
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    rotation: layer.rotation,
    opacity: layer.opacity,
    zIndex: layer.zIndex,
    isBase: layer.isBaseImage,
  }
  if (source.kind === 'blank' || source.kind === 'rect') {
    entry.fill = source.fill
  }
  if (layer.border !== undefined) {
    entry.border = manifestBorder(layer.border)
  }
  return entry
}

/**
 * Build the manifest document from canonical state + the SAME resolved sources
 * the raster was built from. @throws if `state.canvas` is null — the
 * orchestrator guards for "no base image" before calling (same contract as
 * `buildSvgDocument`).
 */
export function buildLayerManifest(
  state: CompositionState,
  sources: Record<string, LayerSource>,
  opts: ManifestOptions,
): LayerManifest {
  const { canvas, layers } = state
  if (!canvas) {
    throw new Error('buildLayerManifest: state.canvas is null (no base image)')
  }

  // The SAME exported-id assignment `buildSvgDocument` uses, so `exportId`
  // here is guaranteed to match the SVG element id emitted alongside.
  const idMap = assignLayerIds(layers)

  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex)

  return {
    format: MANIFEST_FORMAT,
    generator: { name: opts.appName ?? 'composa.', version: opts.appVersion },
    exportedAt: opts.timestamp,
    canvas: { width: canvas.width, height: canvas.height },
    image: {
      filename: opts.imageFilename,
      mimeType: opts.imageMimeType,
      width: canvas.width,
      height: canvas.height,
    },
    layers: sorted.map((layer) =>
      manifestLayer(
        layer,
        sources[layer.id] ?? { kind: 'blank', fill: '#ffffff' },
        idMap.get(layer.id) ?? '',
      ),
    ),
  }
}

/** Serialize deterministically: 2-space indent, fixed key order (insertion). */
export function serializeLayerManifest(manifest: LayerManifest): string {
  return JSON.stringify(manifest, null, 2)
}
