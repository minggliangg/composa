import type { CompositionState } from '../types/layer'
import { reencodeOriginal } from '../wasm/imageProcessor'
import type { LayerSource } from './buildSvgDocument'
import { namespaceSvgMarkup } from './svgNamespace'

/**
 * Resolve every layer's export `LayerSource` from its `fullResBytesRef` — the
 * shared seam between the SVG exporter (`exportComposition`) and the raster
 * exporter (`exportWebp`), so the two can never resolve a layer differently.
 *
 * Extracted verbatim from `exportComposition` (which previously owned this
 * logic + cache); behavior is byte-identical.
 *
 *   - `{ kind: 'svg' }` layers are id/class-namespaced (synchronous, prefix =
 *     sorted index `L<n>`) so duplicate ids can't collide;
 *   - `blank`/`text`/`rect` layers pass through synchronously (no WASM);
 *   - `{ kind: 'reencoded' }` use their cached URI;
 *   - `{ kind: 'file' }` layers are re-encoded via the WASM worker, memoized in
 *     a `WeakMap` keyed by the `File` so a re-export never re-encodes.
 *
 * All resolutions run in parallel; only rasters can reject. A rejection in any
 * single entry rejects the whole `Promise.all` — callers translate that into
 * "fail the whole export" semantics. The rejection carries the stable WASM
 * error code in `err.message`.
 */
const fullResCache = new WeakMap<File, string>()

export async function resolveLayerSources(
  state: CompositionState,
): Promise<Record<string, LayerSource>> {
  // The svg id/class namespace prefix is the layer's SORTED (z-index) index
  // `L0`, `L1`, … — NOT layer.id — so the emitted bytes stay deterministic.
  const sorted = [...state.layers].sort((a, b) => a.zIndex - b.zIndex)
  const sortedIndex = new Map(sorted.map((l, i) => [l.id, i] as const))

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
      } else if (ref.kind === 'text') {
        // Text resolves synchronously — no WASM, no cache. The builder lays
        // out the lines from the same pure `layoutText` the canvas uses.
        source = { kind: 'text', text: ref.text }
      } else if (ref.kind === 'rect') {
        // A plain rectangle (frame) resolves synchronously — no WASM, no cache.
        source = { kind: 'rect', fill: ref.fill }
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
  return Object.fromEntries(entries)
}
