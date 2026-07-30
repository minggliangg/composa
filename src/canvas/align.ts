/**
 * Pure alignment + distribution math for the selected layers, mirroring the
 * `resize.ts` / `coords.ts` convention (pure functions, fully unit-testable).
 *
 * Each function takes the selected layer rects and returns a list of transform
 * patches `{ id, patch: { x?, y? } }` that the caller writes through the store's
 * `updateLayersTransform` seam (which also snaps every value to the half-pixel
 * grid). The caller is responsible for passing only the layers an operation
 * applies to and gating by selection size.
 *
 *   - `alignToCanvas`:    align each rect to the canvas edges/center.
 *   - `alignToSelection`: align each rect to the SELECTION bounding box
 *                         (needs >= 2 layers to be meaningful).
 *   - `distribute`:       equalize CENTER spacing between layers along an axis
 *                         (needs >= 2 layers; >= 3 to be meaningful; first/last
 *                         centers stay fixed).
 *   - `spaceEvenly`:      equalize the GAP between layers along an axis, either
 *                         auto-derived from the two edge elements or at a fixed
 *                         pixel gap (needs >= 2 layers; >= 3 for auto to be
 *                         meaningful).
 *
 * Origin (0,0) is the canvas top-left; y grows downward.
 */

/** A layer's id + geometry in canvas units. */
export interface AlignRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/** Alignment targets shared by canvas- and selection-relative alignment. */
export type AlignTarget =
  | 'left'
  | 'center-h'
  | 'right'
  | 'top'
  | 'center-v'
  | 'bottom'

/** Distribution axis. */
export type DistributeAxis = 'horizontal' | 'vertical'

/** A transform patch bound to the layer it applies to (compatible with the
 *  store's `LayerTransformUpdate`). */
export interface AlignUpdate {
  id: string
  patch: { x?: number; y?: number }
}

/** Horizontal center of a rect. */
const cx = (r: AlignRect): number => r.x + r.width / 2
/** Vertical center of a rect. */
const cy = (r: AlignRect): number => r.y + r.height / 2

/** Align every rect to the canvas edges/center. Returns one patch per rect. */
export function alignToCanvas(
  rects: AlignRect[],
  canvas: { width: number; height: number },
  target: AlignTarget,
): AlignUpdate[] {
  switch (target) {
    case 'left':
      return rects.map((r) => ({ id: r.id, patch: { x: 0 } }))
    case 'center-h':
      return rects.map((r) => ({
        id: r.id,
        patch: { x: (canvas.width - r.width) / 2 },
      }))
    case 'right':
      return rects.map((r) => ({
        id: r.id,
        patch: { x: canvas.width - r.width },
      }))
    case 'top':
      return rects.map((r) => ({ id: r.id, patch: { y: 0 } }))
    case 'center-v':
      return rects.map((r) => ({
        id: r.id,
        patch: { y: (canvas.height - r.height) / 2 },
      }))
    case 'bottom':
      return rects.map((r) => ({
        id: r.id,
        patch: { y: canvas.height - r.height },
      }))
    default: {
      const _exhaustive: never = target
      return _exhaustive
    }
  }
}

/** Align every rect to the selection's bounding box. */
export function alignToSelection(
  rects: AlignRect[],
  target: AlignTarget,
): AlignUpdate[] {
  if (rects.length === 0) return []
  const minX = Math.min(...rects.map((r) => r.x))
  const maxX = Math.max(...rects.map((r) => r.x + r.width))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxY = Math.max(...rects.map((r) => r.y + r.height))
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  switch (target) {
    case 'left':
      return rects.map((r) => ({ id: r.id, patch: { x: minX } }))
    case 'center-h':
      return rects.map((r) => ({ id: r.id, patch: { x: midX - r.width / 2 } }))
    case 'right':
      return rects.map((r) => ({ id: r.id, patch: { x: maxX - r.width } }))
    case 'top':
      return rects.map((r) => ({ id: r.id, patch: { y: minY } }))
    case 'center-v':
      return rects.map((r) => ({ id: r.id, patch: { y: midY - r.height / 2 } }))
    case 'bottom':
      return rects.map((r) => ({ id: r.id, patch: { y: maxY - r.height } }))
    default: {
      const _exhaustive: never = target
      return _exhaustive
    }
  }
}

/**
 * Distribute rects so their CENTERS are evenly spaced along `axis`. The
 * leftmost/topmost and rightmost/bottommost centers stay fixed; the rest are
 * repositioned to equalize spacing. Returns `[]` for fewer than 2 rects.
 */
export function distribute(
  rects: AlignRect[],
  axis: DistributeAxis,
): AlignUpdate[] {
  if (rects.length < 2) return []

  const ordered = [...rects].sort((a, b) =>
    axis === 'horizontal' ? cx(a) - cx(b) : cy(a) - cy(b),
  )
  const firstCenter = axis === 'horizontal' ? cx(ordered[0]) : cy(ordered[0])
  const lastCenter =
    axis === 'horizontal'
      ? cx(ordered[ordered.length - 1])
      : cy(ordered[ordered.length - 1])
  const step = (lastCenter - firstCenter) / (ordered.length - 1)

  return ordered.map((r, i) => {
    const targetCenter = firstCenter + step * i
    if (axis === 'horizontal') {
      return { id: r.id, patch: { x: targetCenter - r.width / 2 } }
    }
    return { id: r.id, patch: { y: targetCenter - r.height / 2 } }
  })
}

/**
 * Space rects so their GAPS are even along `axis`, unlike `distribute` which
 * equalizes CENTER spacing (and so leaves unequal gaps when sizes differ).
 *
 *   - `gap === null` (AUTO): derive the gap from the two EDGE elements, holding
 *     the outer (min leading edge / max trailing edge) bounds fixed. The layers
 *     are packed so the first rect's leading edge and the last rect's trailing
 *     edge don't move.
 *   - `gap === n` (FIXED): place exactly `n` units between consecutive rects,
 *     anchored at the first rect's current leading edge.
 *
 * Returns `[]` for fewer than 2 rects. A computed negative step in AUTO mode is
 * deliberate and unclamped (it's what an already-overlapping selection
 * produces, and clamping would violate the fixed-outer-bounds contract). Patches
 * carry only `x` (horizontal) or only `y` (vertical).
 *
 * Positions are exact floats; the caller's `quantizePatch` rounds each
 * independently. Since stored sizes are on the 0.5 grid, the first and last
 * positions land on 0.5 multiples and survive quantization untouched, so outer
 * bounds are preserved exactly.
 */
export function spaceEvenly(
  rects: AlignRect[],
  axis: DistributeAxis,
  gap: number | null,
): AlignUpdate[] {
  if (rects.length < 2) return []

  const lead = (r: AlignRect) => (axis === 'horizontal' ? r.x : r.y)
  const size = (r: AlignRect) => (axis === 'horizontal' ? r.width : r.height)
  const cross = (r: AlignRect) => (axis === 'horizontal' ? r.y : r.x)

  // TOTAL order — leading edge, then cross-axis, then id — so the result never
  // depends on sort stability or on selection order.
  const ordered = [...rects].sort(
    (a, b) =>
      lead(a) - lead(b) ||
      cross(a) - cross(b) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )

  let step: number
  if (gap === null) {
    // AUTO: derived from the two edge elements, outer bounds held fixed.
    // maxEdge is the MAX TRAILING EDGE, not the last-sorted rect's — a wide rect
    // can start earlier yet extend furthest.
    const minEdge = Math.min(...rects.map(lead))
    const maxEdge = Math.max(...rects.map((r) => lead(r) + size(r)))
    const total = rects.reduce((sum, r) => sum + size(r), 0)
    step = (maxEdge - minEdge - total) / (ordered.length - 1)
  } else {
    step = gap
  }

  // ordered[0] holds the min leading edge, so this pins the anchor in BOTH modes.
  let cursor = lead(ordered[0])
  return ordered.map((r) => {
    const pos = cursor
    cursor = pos + size(r) + step
    return axis === 'horizontal'
      ? { id: r.id, patch: { x: pos } }
      : { id: r.id, patch: { y: pos } }
  })
}
