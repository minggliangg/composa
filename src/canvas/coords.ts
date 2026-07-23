/**
 * Screen <-> canvas-unit coordinate math, driven by the SVG's CTM so it stays
 * correct under any `preserveAspectRatio` letterboxing (plan §4).
 *
 * The live canvas is an `<svg viewBox="0 0 W H">`; the browser maps canvas units
 * to screen pixels via the current transformation matrix (CTM), which also
 * encodes any letterbox offset. To convert a screen pointer position back into
 * canvas units we apply the inverse of that CTM.
 */

/** A point in canvas (SVG user) units. */
export interface CanvasPoint {
  x: number
  y: number
}

/**
 * Minimal view of a 2D affine matrix: the six components
 *   | a c e |
 *   | b d f |
 *   | 0 0 1 |
 *
 * `DOMMatrix` (returned by `SVGSVGElement.getScreenCTM()` in a real browser)
 * exposes exactly these as properties `a,b,c,d,e,f`, so it satisfies this
 * interface structurally and can be passed straight in. Defining our own type
 * keeps the math unit-testable in jsdom, which does NOT implement `DOMMatrix`
 * at all — tests pass a plain object literal instead.
 */
export interface AffineMatrix {
  /** m11 — x-scale */
  readonly a: number
  /** m12 — y-skew (typically 0 for axis-aligned SVGs) */
  readonly b: number
  /** m21 — x-skew (typically 0) */
  readonly c: number
  /** m22 — y-scale */
  readonly d: number
  /** m41 — x-translate */
  readonly e: number
  /** m42 — y-translate */
  readonly f: number
}

/**
 * Pure, DOM-free screen→canvas conversion: apply the INVERSE of `ctm` to a
 * screen-space point.
 *
 * For the affine matrix above (det = a*d − b*c), the inverse is
 *   |  d/det  -c/det  (c*f − d*e)/det |
 *   | -b/det   a/det  (b*e − a*f)/det |
 *   |   0       0           1         |
 * and applying it to (clientX, clientY) yields the canvas-unit point.
 *
 * Exported and free of any DOM dependency so the coordinate math is fully
 * unit-testable without a real SVG element — tests construct a literal matrix.
 */
export function convertViaMatrix(
  clientX: number,
  clientY: number,
  ctm: AffineMatrix,
): CanvasPoint {
  const det = ctm.a * ctm.d - ctm.b * ctm.c
  // A singular CTM (det === 0) cannot be inverted; return the raw point as a
  // safe fallback rather than producing Infinity/NaN. This never happens for a
  // normally-rendered SVG but keeps the function total.
  if (det === 0) return { x: clientX, y: clientY }
  const invDet = 1 / det
  const a = ctm.d * invDet
  const b = -ctm.b * invDet
  const c = -ctm.c * invDet
  const d = ctm.a * invDet
  const e = (ctm.c * ctm.f - ctm.d * ctm.e) * invDet
  const f = (ctm.b * ctm.e - ctm.a * ctm.f) * invDet
  return {
    x: a * clientX + c * clientY + e,
    y: b * clientX + d * clientY + f,
  }
}

/**
 * Convert a screen-space (client) coordinate into canvas units for the given
 * SVG, using its current transformation matrix. Falls back to a
 * bounding-rect + viewBox scale when `getScreenCTM()` is unavailable (e.g. in
 * jsdom, where layout/CTM are not computed) so the call never throws.
 */
export function screenToCanvas(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): CanvasPoint {
  const ctm = svg.getScreenCTM()
  if (ctm) return convertViaMatrix(clientX, clientY, ctm)

  // Bounding-rect fallback: scale the client offset by the viewBox/rect ratio.
  const rect = svg.getBoundingClientRect()
  const vb = svg.viewBox.baseVal
  if (
    rect.width === 0 ||
    rect.height === 0 ||
    vb.width === 0 ||
    vb.height === 0
  ) {
    return { x: 0, y: 0 }
  }
  return {
    x: ((clientX - rect.left) / rect.width) * vb.width,
    y: ((clientY - rect.top) / rect.height) * vb.height,
  }
}
