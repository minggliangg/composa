/**
 * Pure snap math for drag alignment (the "hold Alt to snap" feature).
 *
 * `computeSnap` takes a moving layer's box (at its drag-START position) plus the
 * raw canvas-unit drag delta, and finds the nearest edge/centre alignment
 * against the canvas and a static set of target boxes. It returns the (possibly
 * nudged) delta and the guide lines to draw. Axes snap INDEPENDENTLY.
 *
 * Candidate lines per box: left / centre-x / right on the x-axis, top /
 * centre-y / bottom on the y-axis — for the moving box, for every target, and
 * for the canvas. The nearest pair within `threshold` wins per axis.
 *
 * Why rounding: `x` and `width` are each on the half-pixel grid (the store
 * quantizes every transform), so a CENTRE lands on a quarter pixel. Every
 * candidate line is rounded to `QUANTIZE_STEP` BEFORE the deltas are compared,
 * so a snapped layer settles exactly on the drawn guide (the store's final
 * quantize then locks the position to the grid) instead of 0.25 px off.
 *
 * Tie-break (documented + asserted): smallest `|delta|`, then canvas over
 * layer, then lowest target index.
 *
 * Pure and DOM-free — table-tested directly. The wiring in `useCanvasPointer`
 * builds the target list (excluding moving / invisible / base layers, whose
 * edges are congruent with the canvas) and passes `threshold = SNAP_THRESHOLD_PX
 * / scale` so the tolerance is constant in screen pixels at any zoom.
 */
import type { CanvasConfig } from '../types/layer'
import { quantize, QUANTIZE_STEP } from './quantize'

/** Default snap tolerance in SCREEN pixels; divide by the current scale for the
 *  canvas-unit threshold the caller passes in. */
export const SNAP_THRESHOLD_PX = 6

export interface SnapRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SnapGuide {
  /** 'v' = a vertical guide (an x position the box aligned to); 'h' = horizontal. */
  orientation: 'v' | 'h'
  /** The canvas-coordinate line the box snapped to. */
  position: number
  /** Extent of the guide along the OTHER axis (start <= end). */
  start: number
  end: number
}

export interface SnapResult {
  /** The (possibly nudged) full drag delta for the x-axis. */
  dx: number
  /** The (possibly nudged) full drag delta for the y-axis. */
  dy: number
  /** Active guides (at most one per axis). */
  guides: SnapGuide[]
}

/** Round to the half-pixel grid. */
const q = (n: number): number => quantize(n, QUANTIZE_STEP)

/** The three candidate lines of a box along one axis (start / centre / end). */
function lines(box: SnapRect, axis: 'x' | 'y'): [number, number, number] {
  return axis === 'x'
    ? [box.x, box.x + box.width / 2, box.x + box.width]
    : [box.y, box.y + box.height / 2, box.y + box.height]
}

interface AxisCandidate {
  absDelta: number
  delta: number
  canvas: boolean
  index: number
  position: number
  start: number
  end: number
}

/** True when `c` outranks incumbent `b` per the documented tie-break. */
function outranks(c: AxisCandidate, b: AxisCandidate): boolean {
  if (c.absDelta !== b.absDelta) return c.absDelta < b.absDelta
  if (c.canvas !== b.canvas) return c.canvas // canvas wins ties over layers
  return c.index < b.index // then lowest target index
}

/**
 * Find the best snap on a single axis.
 *
 * `movingLines` are the moving box's rounded candidate positions on this axis;
 * `cur` is the moving box at its current (dragged) position, for guide extents;
 * `sources` are the canvas + targets. Returns the winning candidate or `null`.
 */
function bestAxis(
  movingLines: [number, number, number],
  cur: SnapRect,
  sources: { canvas: boolean; index: number; box: SnapRect }[],
  axis: 'x' | 'y',
  threshold: number,
): AxisCandidate | null {
  let best: AxisCandidate | null = null
  for (const src of sources) {
    const targetLines = lines(src.box, axis).map(q) as [number, number, number]
    for (let mi = 0; mi < 3; mi++) {
      for (let ti = 0; ti < 3; ti++) {
        const delta = targetLines[ti] - movingLines[mi]
        const absDelta = Math.abs(delta)
        if (absDelta > threshold) continue
        // Guide spans the moving box and the target on the OTHER axis.
        const [mLo, mHi] =
          axis === 'x' ? [cur.y, cur.y + cur.height] : [cur.x, cur.x + cur.width]
        const [tLo, tHi] =
          axis === 'x'
            ? [src.box.y, src.box.y + src.box.height]
            : [src.box.x, src.box.x + src.box.width]
        const candidate: AxisCandidate = {
          absDelta,
          delta,
          canvas: src.canvas,
          index: src.index,
          position: targetLines[ti],
          start: Math.min(mLo, tLo),
          end: Math.max(mHi, tHi),
        }
        if (best === null || outranks(candidate, best)) best = candidate
      }
    }
  }
  return best
}

/**
 * Compute the snap (if any) for the moving box given its drag delta.
 *
 * `movingBox` is the box at drag START; `dx`/`dy` is the raw unsnapped delta, so
 * the box's current position is `(movingBox.x + dx, movingBox.y + dy)`. The
 * returned `dx`/`dy` are the FULL adjusted deltas for the caller to apply
 * (unchanged when nothing is in range); `guides` carries at most one vertical
 * and one horizontal guide.
 */
export function computeSnap(
  movingBox: SnapRect,
  targets: SnapRect[],
  canvas: CanvasConfig,
  dx: number,
  dy: number,
  threshold: number,
): SnapResult {
  const cur: SnapRect = {
    x: movingBox.x + dx,
    y: movingBox.y + dy,
    width: movingBox.width,
    height: movingBox.height,
  }

  // The canvas is always a candidate; its edges (0 / centre / far edge) cover
  // the canvas frame and centre lines. Layers are indexed in array order.
  const sources = [
    {
      canvas: true,
      index: 0,
      box: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    },
    ...targets.map((box, index) => ({ canvas: false, index, box })),
  ]

  const movingX = lines(cur, 'x').map(q) as [number, number, number]
  const movingY = lines(cur, 'y').map(q) as [number, number, number]

  const bestX = bestAxis(movingX, cur, sources, 'x', threshold)
  const bestY = bestAxis(movingY, cur, sources, 'y', threshold)

  const guides: SnapGuide[] = []
  if (bestX) {
    guides.push({
      orientation: 'v',
      position: bestX.position,
      start: bestX.start,
      end: bestX.end,
    })
  }
  if (bestY) {
    guides.push({
      orientation: 'h',
      position: bestY.position,
      start: bestY.start,
      end: bestY.end,
    })
  }

  return {
    dx: dx + (bestX ? bestX.delta : 0),
    dy: dy + (bestY ? bestY.delta : 0),
    guides,
  }
}
