/**
 * Pure resize math for the eight selection handles (plan §4 / Phase 05).
 *
 *   - CORNER handles (`nw`, `ne`, `se`, `sw`) preserve the layer's natural
 *     aspect ratio. The diagonally-opposite corner is the fixed ANCHOR; the
 *     scale is taken from the DOMINANT axis (the one with the larger relative
 *     motion) and applied uniformly, then the non-moving edges are re-pinned
 *     to the anchor.
 *   - EDGE handles (`n`, `s`, `e`, `w`) do single-axis FREE resize — only their
 *     own dimension changes, the opposite edge stays pinned.
 *
 * Every dimension is floored at `MIN_LAYER_SIZE`; width/height are never
 * negative. Flipping past an anchor is disallowed (clamped at the floor so the
 * anchor edge stays put).
 */
import type { CanvasPoint } from './coords'

/** Floor for any resize dimension, in canvas units. */
export const MIN_LAYER_SIZE = 20

export type ResizeHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A rect plus the layer's natural pixel dims, needed for aspect-ratio math. */
export type ResizeStart = Rect & {
  naturalWidth: number
  naturalHeight: number
}

/**
 * Per-corner geometry.
 *
 * `sideX`/`sideY` identify which edge of the START rect the fixed anchor lives
 * on ('left'/'right', 'top'/'bottom'). `sx`/`sy` are the signs such that
 * `sx * (pointer − anchor)` is POSITIVE when the drag grows the rect (so a
 * meaningful scale is non-negative while growing).
 *
 *   se: anchor = top-left      (left,  top)    sx = +1, sy = +1
 *   nw: anchor = bottom-right  (right, bottom) sx = −1, sy = −1
 *   ne: anchor = bottom-left   (left,  bottom) sx = +1, sy = −1
 *   sw: anchor = top-right     (right, top)    sx = −1, sy = +1
 */
interface CornerSpec {
  sideX: 'left' | 'right'
  sideY: 'top' | 'bottom'
  sx: 1 | -1
  sy: 1 | -1
}

const CORNERS: Record<'nw' | 'ne' | 'se' | 'sw', CornerSpec> = {
  se: { sideX: 'left', sideY: 'top', sx: 1, sy: 1 },
  nw: { sideX: 'right', sideY: 'bottom', sx: -1, sy: -1 },
  ne: { sideX: 'left', sideY: 'bottom', sx: 1, sy: -1 },
  sw: { sideX: 'right', sideY: 'top', sx: -1, sy: 1 },
}

function resizeCorner(
  spec: CornerSpec,
  start: ResizeStart,
  pointer: CanvasPoint,
): Rect {
  // Fixed anchor = the diagonally-opposite corner of the START rect.
  const anchorX = spec.sideX === 'left' ? start.x : start.x + start.width
  const anchorY = spec.sideY === 'top' ? start.y : start.y + start.height

  // Extent from the anchor along each axis; positive while the drag grows the
  // rect, negative while shrinking past the anchor.
  const extentX = spec.sx * (pointer.x - anchorX)
  const extentY = spec.sy * (pointer.y - anchorY)

  // Candidate per-axis scale relative to the start size.
  const scaleX = extentX / start.width
  const scaleY = extentY / start.height

  // DOMINANT axis drives the uniform scale so the aspect ratio is preserved.
  // (On a tie, x wins — arbitrary but deterministic.)
  const scale =
    Math.abs(scaleX) >= Math.abs(scaleY) ? scaleX : scaleY

  const aspect = start.naturalWidth / start.naturalHeight
  // Clamp width at MIN: this also catches a non-positive scale (drag past the
  // anchor), preventing any flip and keeping the anchor edge pinned.
  const width = Math.max(MIN_LAYER_SIZE, start.width * scale)
  const height = width / aspect

  // Reposition so the anchor edge stays fixed.
  const x = spec.sideX === 'left' ? anchorX : anchorX - width
  const y = spec.sideY === 'top' ? anchorY : anchorY - height

  return { x, y, width, height }
}

/**
 * Apply a resize gesture for `handle`, given the layer's start rect (plus
 * natural dims) and the current pointer position in canvas units. Returns the
 * new rect; width/height are always ≥ MIN_LAYER_SIZE (edges) or width ≥ MIN
 * with height derived from the natural aspect (corners), and never negative.
 */
export function applyResize(
  handle: ResizeHandleId,
  start: ResizeStart,
  pointer: CanvasPoint,
): Rect {
  switch (handle) {
    case 'se':
    case 'nw':
    case 'ne':
    case 'sw':
      return resizeCorner(CORNERS[handle], start, pointer)

    // East edge: right edge follows the pointer, left edge (x) stays pinned.
    case 'e':
      return {
        x: start.x,
        y: start.y,
        width: Math.max(MIN_LAYER_SIZE, pointer.x - start.x),
        height: start.height,
      }

    // West edge: right edge pinned, left edge (x) follows the pointer.
    case 'w': {
      const right = start.x + start.width
      const width = Math.max(MIN_LAYER_SIZE, right - pointer.x)
      return { x: right - width, y: start.y, width, height: start.height }
    }

    // South edge: bottom edge follows the pointer, top edge (y) stays pinned.
    case 's':
      return {
        x: start.x,
        y: start.y,
        width: start.width,
        height: Math.max(MIN_LAYER_SIZE, pointer.y - start.y),
      }

    // North edge: bottom edge pinned, top edge (y) follows the pointer.
    case 'n': {
      const bottom = start.y + start.height
      const height = Math.max(MIN_LAYER_SIZE, bottom - pointer.y)
      return { x: start.x, y: bottom - height, width: start.width, height }
    }

    default: {
      // Exhaustiveness guard — every ResizeHandleId is handled above.
      const _exhaustive: never = handle
      return _exhaustive
    }
  }
}
