/**
 * Viewport zoom/pan math (the "fancy fox" plan, Phase 4).
 *
 * The viewport is implemented with a CSS `transform: translate() scale()` on a
 * wrapper around the editor `<svg>` (NOT by manipulating the `viewBox` — that
 * would break `computeCanvasScale`'s assumptions and force reworking the pointer
 * math). `getScreenCTM()` already folds ancestor CSS transforms into the CTM,
 * so `screenToCanvas`, resize, and the pointer hooks need ZERO changes.
 *
 * Pure math only (no DOM), following the `coords.ts` / `resize.ts` precedent so
 * the cursor-anchoring math is unit-testable in jsdom.
 */

export interface ViewPoint {
  x: number
  y: number
}

/** User-multiplier bounds: 1 = fit-to-panel; the canvas is unusable past these. */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 32

/** Clamp a zoom multiplier to `[MIN_ZOOM, MAX_ZOOM]`; non-finite → 1. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/**
 * Zoom by `factor` about an anchor point, keeping the canvas point under the
 * anchor fixed on screen.
 *
 * Model: the wrapper has `transform: translate(pan) scale(zoom)` with
 * `transform-origin: 50% 50%`. A local point P maps to screen as
 *   screen = zoom * (P − origin) + origin + pan
 * where `origin` is the wrapper's (layout) center. Holding the screen anchor A
 * fixed across zoom → zoom' yields
 *   pan' = anchor − (zoom'/zoom) * (anchor − pan)
 * with `anchor` and `pan` measured RELATIVE TO `origin` (anchor = cursor −
 * origin). Both arguments are therefore origin-relative screen px; the caller
 * computes `anchor` from the cursor and the section rect.
 *
 * Returns the clamped new zoom and the adjusted pan. If `factor` doesn't move
 * zoom off a clamp bound, the ratio is taken against the clamped result so the
 * anchor still tracks exactly.
 */
export function zoomAtPoint(
  zoom: number,
  pan: ViewPoint,
  factor: number,
  anchor: ViewPoint,
): { zoom: number; pan: ViewPoint } {
  const newZoom = clampZoom(zoom * factor)
  const ratio = newZoom / zoom // accounts for clamping at the bounds
  return {
    zoom: newZoom,
    pan: {
      x: anchor.x - ratio * (anchor.x - pan.x),
      y: anchor.y - ratio * (anchor.y - pan.y),
    },
  }
}
