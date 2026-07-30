/**
 * The vector import path (the "fancy fox" plan, Phase 1).
 *
 * Raster uploads run through the Rust/WASM `image` crate, which cannot decode
 * SVG. Vector input instead takes a fully TS-side path: read as text, sanitize
 * via `DOMParser` (jsdom-safe), derive intrinsic size, and hand back sanitized
 * markup + a `viewBox`. No rasterization — vector fidelity is preserved
 * end-to-end (import → editor → exported nested `<svg>`).
 *
 * This module is pure aside from the DOM parse/serialize (both available in
 * jsdom), so it is unit-testable without a worker, following the `coords.ts` /
 * `resize.ts` / `align.ts` precedent.
 */
import { MAX_SOURCE_DIMENSION } from './fileValidation'

/** Text-size cap on the SVG source, guarding the exported document's size. */
export const MAX_SVG_BYTES = 2_000_000
/** Fallback square size when neither dims nor a viewBox are present. */
export const DEFAULT_SVG_SIZE = 512

export type SvgParseResult =
  | {
      ok: true
      /** Sanitized markup; root is `<svg>` and carries a `viewBox`. */
      markup: string
      /** The root `<svg>`'s `viewBox` (`min-x min-y w h`), synthesized if absent. */
      viewBox: string
      naturalWidth: number
      naturalHeight: number
    }
  | {
      ok: false
      reason: 'svg_parse_failed' | 'svg_too_large' | 'dimensions_too_large'
    }

/**
 * Elements safe to keep in an SVG the app will later EMBED in an exported
 * document. This is an allow-list (not a deny-list): the exported file becomes
 * one document that other tools open, so the safe default is "drop what I don't
 * recognize." This covers dropping `script`, `foreignObject`, the SMIL
 * animation elements (`animate`, `animateMotion`, `animateTransform`, `set`),
 * and `handler`.
 *
 * Case is significant: SVG is XML, so `linearGradient` ≠ `lineargradient`. The
 * `fe*` filter primitives are matched by prefix rather than enumerated.
 */
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'path', 'rect',
  'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'image',
  'clipPath', 'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient',
  'stop', 'filter', 'style',
])

function isAllowedElement(localName: string): boolean {
  if (ALLOWED_ELEMENTS.has(localName)) return true
  // fe* filter primitives (feGaussianBlur, feOffset, feMerge, feMergeNode, …).
  return localName.startsWith('fe') && localName.length > 2
}

/** Absolute-length units → px at 96 dpi. Percentages are NOT here (they fall
 *  back to the viewBox). */
const UNIT_TO_PX: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 96 / 72,
  pc: 16, // 1 pica = 12 pt
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
}

/**
 * Parse a single SVG length attribute (e.g. `100`, `100px`, `0.5in`) into px.
 * Returns `null` for a percentage (caller falls back to the viewBox) or an
 * unparseable / non-absolute value.
 */
function parseLength(attr: string | null): number | null {
  if (attr == null) return null
  const m = attr.trim().match(/^(-?[\d.]+(?:[eE][-+]?\d+)?)\s*(px|pt|pc|mm|cm|in|%)?$/)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value)) return null
  const unit = (m[2] ?? '').toLowerCase()
  if (unit === '%') return null // percentage → defer to the viewBox
  const factor = UNIT_TO_PX[unit]
  if (factor === undefined) return null
  return value * factor
}

/** Parse a `viewBox` string into its w/h (the first two members are offsets). */
function parseViewBoxAttr(
  vb: string | null,
): { width: number; height: number } | null {
  if (!vb) return null
  const parts = vb.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  return { width: parts[2], height: parts[3] }
}

/**
 * Resolve an SVG's intrinsic pixel size. Precedence:
 *   1. `width`/`height` in absolute units (unitless, px, pt, pc, mm, cm, in).
 *   2. Percentage or missing → the `viewBox` w/h.
 *   3. Exactly one of width/height + a viewBox → derive the other from aspect.
 *   4. Neither dims nor viewBox → `DEFAULT_SVG_SIZE` square.
 *
 * Exported separately so the precedence matrix is unit-testable without parsing.
 */
export function resolveSvgDimensions(
  widthAttr: string | null,
  heightAttr: string | null,
  viewBox: string | null,
): { width: number; height: number } {
  const w = parseLength(widthAttr)
  const h = parseLength(heightAttr)
  const vb = parseViewBoxAttr(viewBox)

  if (w != null && h != null) return { width: w, height: h }
  if (w != null && vb) {
    const aspect = vb.width / vb.height
    return { width: w, height: w / aspect }
  }
  if (h != null && vb) {
    const aspect = vb.width / vb.height
    return { width: h * aspect, height: h }
  }
  if (vb) return { width: vb.width, height: vb.height }
  // One dim present but no viewBox: assume square (no aspect info available).
  if (w != null) return { width: w, height: w }
  if (h != null) return { width: h, height: h }
  return { width: DEFAULT_SVG_SIZE, height: DEFAULT_SVG_SIZE }
}

/**
 * Rewrite `url(...)` references inside an attribute value, keeping only
 * `url(#…)` and `url(data:…)` and dropping the rest (external fetches). Applied
 * to presentation attributes and inline `style` so a `fill="url(http://…)"`
 * can't pull a remote resource.
 */
function scrubUrlRefs(value: string): string {
  return value.replace(
    /url\(\s*(['"]?)([^'")]*?)\1\s*\)/gi,
    (full, _q, ref) => {
      const r = ref.trim()
      if (r.startsWith('#') || r.startsWith('data:')) return full
      return ''
    },
  )
}

/**
 * Clean one attribute's value. Returns the cleaned value, or `null` to drop the
 * attribute entirely:
 *   - drop any `on*` event handler,
 *   - drop `href`/`xlink:href` unless it points at a fragment or a `data:image/`,
 *   - drop any value containing `javascript:`,
 *   - scrub disallowed `url(...)` references (above).
 */
function scrubAttrValue(name: string, value: string): string | null {
  const lowerName = name.toLowerCase()
  if (lowerName.startsWith('on')) return null
  if (lowerName === 'href' || lowerName.endsWith(':href')) {
    const v = value.trim()
    if (v.startsWith('#') || v.startsWith('data:image/')) return value
    return null
  }
  if (/javascript:/i.test(value)) return null
  return scrubUrlRefs(value)
}

/** Scrub a `<style>` element's CSS text: drop `expression()` / `-moz-binding`,
 *  `javascript:`, and disallowed `url(...)`. (Id/class namespacing happens at
 *  EXPORT — see `namespaceSvgMarkup` — not here.) */
function scrubStyleText(css: string): string {
  return css
    .replace(/expression\s*\(/gi, '')
    .replace(/-moz-binding/gi, '')
    .replace(/javascript:/gi, '')
    .replace(
      /url\(\s*(['"]?)([^'")]*?)\1\s*\)/gi,
      (full, _q, ref) => {
        const r = ref.trim()
        if (r.startsWith('#') || r.startsWith('data:')) return full
        return ''
      },
    )
}

/**
 * Sanitize an already-parsed SVG document in place: remove every
 * non-allow-listed element, scrub attributes on every survivor, and clean
 * `<style>` text content. The root `<svg>` is assumed valid (caller checks).
 */
function sanitizeSvg(root: Element): void {
  // Remove disallowed elements. Snapshot first — mutating a live NodeList
  // while iterating it skips nodes.
  const all = Array.from(root.querySelectorAll('*'))
  for (const el of all) {
    if (!isAllowedElement(el.localName)) {
      el.remove()
      continue
    }
  }
  // Scrub attributes on every survivor (including the root).
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      const cleaned = scrubAttrValue(attr.name, attr.value)
      if (cleaned === null) {
        el.removeAttribute(attr.name)
      } else if (cleaned !== attr.value) {
        el.setAttribute(attr.name, cleaned)
      }
    }
    if (el.localName === 'style') {
      const cleaned = scrubStyleText(el.textContent ?? '')
      if (cleaned !== (el.textContent ?? '')) el.textContent = cleaned
    }
  }
}

/**
 * Parse + sanitize an SVG source string into a form safe to embed and render.
 *
 * Returns `{ ok: true, markup, viewBox, naturalWidth, naturalHeight }` on
 * success, or `{ ok: false, reason }` for: oversize text (`svg_too_large`),
 * unparseable / non-`<svg>` input (`svg_parse_failed`), or a resolved dimension
 * over `MAX_SOURCE_DIMENSION` (`dimensions_too_large`, parity with rasters).
 *
 * The returned markup's root always carries a `viewBox` (synthesized from the
 * resolved dims when absent) so `preserveAspectRatio="none"` stretching behaves
 * identically to raster layers in both the editor and the export.
 */
export function parseSvgSource(text: string): SvgParseResult {
  if (text.length > MAX_SVG_BYTES) {
    return { ok: false, reason: 'svg_too_large' }
  }

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  } catch {
    return { ok: false, reason: 'svg_parse_failed' }
  }
  // A parse failure surfaces as a <parsererror> element (browsers + jsdom), or
  // as a root that simply isn't <svg>.
  if (doc.querySelector('parsererror')) {
    return { ok: false, reason: 'svg_parse_failed' }
  }
  const root = doc.documentElement
  if (!root || root.localName !== 'svg') {
    return { ok: false, reason: 'svg_parse_failed' }
  }

  // Resolve dims from the ORIGINAL attributes, before we synthesize a viewBox.
  const dims = resolveSvgDimensions(
    root.getAttribute('width'),
    root.getAttribute('height'),
    root.getAttribute('viewBox'),
  )
  if (
    dims.width > MAX_SOURCE_DIMENSION ||
    dims.height > MAX_SOURCE_DIMENSION ||
    !Number.isFinite(dims.width) ||
    !Number.isFinite(dims.height)
  ) {
    return { ok: false, reason: 'dimensions_too_large' }
  }

  sanitizeSvg(root)

  // Synthesize a viewBox on the root if absent, so stretching is deterministic.
  if (!root.getAttribute('viewBox')) {
    root.setAttribute('viewBox', `0 0 ${dims.width} ${dims.height}`)
  }

  const markup = new XMLSerializer().serializeToString(root)
  const viewBox = root.getAttribute('viewBox')!
  return {
    ok: true,
    markup,
    viewBox,
    naturalWidth: dims.width,
    naturalHeight: dims.height,
  }
}
