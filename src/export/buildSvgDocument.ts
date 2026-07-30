import type { CompositionState, Layer, TextContent } from '../types/layer'
import { xmlEscapeAttr } from './xmlEscape'
import { assignLayerIds, borderIdKey } from './layerIds'
import { layoutText, textAlignAnchor, TEXT_FONT_FAMILY } from '../text/textMetrics'
import { borderRect } from '../canvas/border'
import type { EmbeddedFontFace } from './fontEmbed'

/**
 * Deterministic OFL-1.1 notice constants for the embedded font. The exported
 * SVG redistributes the font bytes, so it carries the notice too. The comment
 * form contains NO `--` sequence (or the document is malformed).
 */
export const FONT_COPYRIGHT =
  'Copyright 2020-2024 The Atkinson Hyperlegible Mono Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next-mono)'
export const FONT_LICENSE = 'OFL-1.1'
const FONT_NOTICE = `${FONT_COPYRIGHT}. Licensed under the SIL Open Font License 1.1. https://scripts.sil.org/OFL`

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
  /** Embedded font faces. When non-empty, a `<defs><style>` block of
   *  `@font-face` rules (preceded by the OFL notice) is emitted, and the
   *  metadata carries `fontLicense` + `fontCopyright`. Empty/omitted = no defs. */
  fontFaces?: EmbeddedFontFace[]
}

/**
 * How a single layer contributes to the exported document. `svg`/`blank`
 * resolve synchronously upstream in `exportComposition` (no WASM); the builder
 * just emits them.
 *   - `raster`: today's embedded `<image>`.
 *   - `blank`: a solid `<rect>` (a blank-base template).
 *   - `svg`: a nested `<svg>` body (`inner`, already id/class-namespaced) + its
 *     source `viewBox`, preserving vector fidelity.
 *   - `text`: a nested `<svg>` + `<text>`/`<tspan>` laid out from the SAME pure
 *     `layoutText` the canvas uses, so editor and export can't drift.
 */
export type LayerSource =
  | { kind: 'raster'; dataUri: string }
  | { kind: 'svg'; inner: string; viewBox: string }
  | { kind: 'blank'; fill: string }
  | { kind: 'text'; text: TextContent }
  | { kind: 'rect'; fill: string | null }

/**
 * The border <rect> line for a layer, or '' when it has none. A TOP-LEVEL
 * SIBLING emitted immediately AFTER the layer's own element, in the SAME
 * layerLines entry, so: paint order is right (it sits above the layer, whose
 * border is outward so there is no double-blend); the layer's own element stays
 * the FIRST element of its entry (`querySelector('rect')` still finds a blank
 * base); no <g> is introduced (the export must contain zero <g>); and it is NOT
 * inside a nested <svg>, whose `preserveAspectRatio="none"` would scale the
 * stroke anisotropically.
 *
 * Carries only `id` + `data-role="border"` — deliberately NO data-name and NO
 * data-filename, so the "exactly one [data-name]" and per-layer filename
 * assertions keep counting layer elements only.
 */
function borderRectLine(layer: Layer, borderId: string): string {
  const r = borderRect(layer)
  if (r === null) return ''
  return (
    `\n  <rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"` +
    ` fill="none" stroke="${r.color}" stroke-width="${r.strokeWidth}"` +
    ` opacity="${layer.opacity}" id="${borderId}" data-role="border" />`
  )
}

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
 *       raster → <image href ... preserveAspectRatio="none" ... /> [+ border?]
 *       blank  → <rect x y width height fill opacity ... />            [+ border?]
 *       rect   → <rect x y width height fill opacity ... />            [+ border?]
 *       svg    → <svg x y width height viewBox preserveAspectRatio="none" opacity ...>inner</svg> [+ border?]
 *       text   → <svg ...><text/></svg>                                [+ border?]
 *   </svg>
 *   (A layer's border <rect>, when present, is the immediately-following
 *   SIBLING of that layer's own element — see `borderRectLine`.)
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
  // escape function avoids drift. When a font is embedded, the licence + copyright
  // travel with the metadata too.
  const meta: Record<string, unknown> = {
    appName: opts.appName ?? 'composa.',
    appVersion: opts.appVersion,
    exportedAt: opts.timestamp,
    canvasWidth: width,
    canvasHeight: height,
    layerCount: layers.length,
  }
  const fontFaces = opts.fontFaces ?? []
  if (fontFaces.length > 0) {
    meta.fontLicense = FONT_LICENSE
    meta.fontCopyright = FONT_COPYRIGHT
  }
  const metadata = JSON.stringify(meta)

  // Ascending z-index == back-to-front paint order (base = 0 first).
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex)

  // Per-layer exported `id` (NCName, deduped in z order). `id` is the sanitised
  // machine handle; `data-name` carries the verbatim custom name losslessly.
  const idMap = assignLayerIds(layers)

  const layerLines = sorted.map((layer) => {
    const source = sources[layer.id] ?? { kind: 'blank', fill: '#ffffff' }
    const idAttr = ` id="${idMap.get(layer.id)}"`
    const roleAttr = layer.isBaseImage ? ' data-role="base"' : ''
    const filenameAttr = ` data-filename="${xmlEscapeAttr(layer.originalFilename)}"`
    const nameAttr =
      layer.name !== null ? ` data-name="${xmlEscapeAttr(layer.name)}"` : ''
    // The layer's border line ('' when it has none). Emitted as the immediately-
    // following sibling of the layer's own element (see `borderRectLine`).
    const borderLine = borderRectLine(
      layer,
      idMap.get(borderIdKey(layer.id)) ?? '',
    )

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
        `${idAttr}` +
        `${filenameAttr}` +
        `${nameAttr}` +
        `${roleAttr} />` + borderLine
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
        `${idAttr}` +
        `${filenameAttr}` +
        `${nameAttr}` +
        `${roleAttr} />` + borderLine
      )
    }

    if (source.kind === 'text') {
      // A text layer: a nested <svg> + <text>/<tspan> mirroring the canvas
      // render MINUS the editor-only hit-rect. Lines come from the SAME pure
      // layoutText the canvas uses, so geometry can't drift. Explicit x/y per
      // tspan (never dy) keeps line positions stable under a font fallback.
      const lines = layoutText(source.text)
      const anchor = textAlignAnchor(source.text.align)
      const italicAttr = source.text.italic ? ' font-style="italic"' : ''
      const tspans = lines
        .map(
          (l) =>
            `<tspan x="${l.x}" y="${l.y}">${xmlEscapeAttr(l.text)}</tspan>`,
        )
        .join('')
      return (
        `  <svg x="${layer.x}"` +
        ` y="${layer.y}"` +
        ` width="${layer.width}"` +
        ` height="${layer.height}"` +
        ` viewBox="0 0 ${layer.naturalWidth} ${layer.naturalHeight}"` +
        ` preserveAspectRatio="none"` +
        ` opacity="${layer.opacity}"` +
        `${idAttr}` +
        `${filenameAttr}` +
        `${nameAttr}` +
        `${roleAttr}>` +
        `<text font-family="'${TEXT_FONT_FAMILY}', ui-monospace, monospace"` +
        ` font-size="${source.text.fontSize}"` +
        ` font-weight="${source.text.fontWeight}"` +
        `${italicAttr}` +
        ` fill="${source.text.fill}"` +
        ` text-anchor="${anchor}">${tspans}</text>` +
        `</svg>` + borderLine
      )
    }

    if (source.kind === 'rect') {
      // A plain rectangle layer (today only created by Frame selection). A
      // transparent (`fill: null`) frame paints nothing here — its `border` is
      // the visible frame, emitted as the immediately-following sibling by
      // `borderLine`. `fill` comes from parseHexColor/null, so unescaped emission
      // matches the existing `blank` arm.
      return (
        `  <rect x="${layer.x}"` +
        ` y="${layer.y}"` +
        ` width="${layer.width}"` +
        ` height="${layer.height}"` +
        ` fill="${source.fill ?? 'none'}"` +
        ` opacity="${layer.opacity}"` +
        `${idAttr}` +
        `${filenameAttr}` +
        `${nameAttr}` +
        `${roleAttr} />` + borderLine
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
      `${idAttr}` +
      `${filenameAttr}` +
      `${nameAttr}` +
      `${roleAttr}>` +
      source.inner +
      `</svg>` + borderLine
    )
  })

  // Embedded font: a <defs><style> block of @font-face rules, preceded by the
  // OFL notice comment, emitted ONLY when font faces are present. The comment
  // carries no `--` sequence (see FONT_NOTICE). `format('woff2')` — not the
  // legacy `'woff2-variations'` token, which some non-browser parsers
  // string-match and then drop the whole `src`. The variable `font-weight: 200
  // 800` axis is kept so any picked weight resolves.
  const fontDefs =
    fontFaces.length > 0
      ? `  <!-- ${FONT_NOTICE} -->\n` +
        `  <defs><style><![CDATA[\n` +
        fontFaces
          .map((f) =>
            '@font-face {\n' +
            `  font-family: '${TEXT_FONT_FAMILY}';\n` +
            `  font-style: ${f.style};\n` +
            '  font-weight: 200 800;\n' +
            `  src: url(${f.dataUri}) format('woff2');\n` +
            '}',
          )
          .join('\n') +
        `\n]]></style></defs>\n`
      : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    `  <metadata>${xmlEscapeAttr(metadata)}</metadata>\n` +
    fontDefs +
    layerLines.join('\n') +
    (layerLines.length > 0 ? '\n' : '') +
    `</svg>`
  )
}
