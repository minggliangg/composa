import { describe, it, expect } from 'vitest'
import {
  computeSnap,
  SNAP_THRESHOLD_PX,
} from '../../src/canvas/snap'
import type { SnapRect } from '../../src/canvas/snap'
import { quantize, QUANTIZE_STEP } from '../../src/canvas/quantize'
import type { CanvasConfig } from '../../src/types/layer'

/**
 * Pure unit tests for the drag-snap math (Step 3). `computeSnap` is DOM-free
 * and table-tested. Canvas is 1000x1000 throughout; boxes are parked off the
 * Y axis (y = 3000) unless a Y snap is intended, so X scenarios stay isolated.
 */

const CANVAS: CanvasConfig = { width: 1000, height: 1000 }

const box = (
  x: number,
  y: number,
  width: number,
  height: number,
): SnapRect => ({ x, y, width, height })

describe('computeSnap — nearest wins', () => {
  it('snaps the nearest moving edge to the nearest target edge', () => {
    const moving = box(296, 3000, 100, 10)
    const target = box(300, 0, 100, 10)
    const res = computeSnap(moving, [target], CANVAS, 0, 0, 6)
    // Moving-left (296) is 4 from target-left (300); lands on 300 after the
    // store's quantize.
    expect(res.guides).toHaveLength(1)
    expect(res.guides[0].orientation).toBe('v')
    expect(res.guides[0].position).toBe(300)
    expect(quantize(moving.x + res.dx)).toBe(300)
  })

  it('axes snap independently (X snaps, Y does not)', () => {
    const moving = box(296, 3000, 100, 10) // y far from any Y line
    const target = box(300, 0, 100, 10)
    const res = computeSnap(moving, [target], CANVAS, 0, 5, 6)
    // X snapped, Y untouched.
    expect(res.dy).toBe(5)
    expect(res.guides.some((g) => g.orientation === 'v')).toBe(true)
    expect(res.guides.some((g) => g.orientation === 'h')).toBe(false)
  })
})

describe('computeSnap — nothing in range', () => {
  it('passes dx/dy through unchanged with no guides', () => {
    const moving = box(100, 100, 50, 50)
    const res = computeSnap(moving, [], CANVAS, 7, 9, 2)
    expect(res.dx).toBe(7)
    expect(res.dy).toBe(9)
    expect(res.guides).toEqual([])
  })
})

describe('computeSnap — canvas edges & centre are candidates', () => {
  it('snaps a moving-left to the canvas left edge (0)', () => {
    const res = computeSnap(box(4, 3000, 50, 10), [], CANVAS, 0, 0, 6)
    expect(res.guides[0]).toMatchObject({ orientation: 'v', position: 0 })
    expect(quantize(4 + res.dx)).toBe(0)
  })

  it('snaps a moving-centre to the canvas centre (500)', () => {
    // cx = 468 + 29 = 497 -> 3 from canvas cx 500.
    const res = computeSnap(box(468, 3000, 58, 10), [], CANVAS, 0, 0, 6)
    expect(res.guides[0]).toMatchObject({ orientation: 'v', position: 500 })
    expect(quantize(497 + res.dx)).toBe(500)
  })

  it('snaps a moving-right to the canvas right edge (1000)', () => {
    // right = 946 + 58 = 1004 -> 4 past canvas right 1000.
    const res = computeSnap(box(946, 3000, 58, 10), [], CANVAS, 0, 0, 6)
    expect(res.guides[0]).toMatchObject({ orientation: 'v', position: 1000 })
    expect(quantize(1004 + res.dx)).toBe(1000)
  })

  it('snaps a moving-top to the canvas top edge (0)', () => {
    const res = computeSnap(box(3000, 4, 10, 50), [], CANVAS, 0, 0, 6)
    expect(res.guides[0]).toMatchObject({ orientation: 'h', position: 0 })
    expect(quantize(4 + res.dy)).toBe(0)
  })
})

describe('computeSnap — tie-breaks', () => {
  it('resolves an equidistant canvas-vs-layer tie in favour of the canvas', () => {
    // moving-left (495) is 5 from canvas-cx (500, +5) and 5 from target-left
    // (490, -5). Equal |delta| -> canvas wins.
    const moving = box(495, 3000, 2000, 10)
    const target = box(490, 0, 22, 10)
    const res = computeSnap(moving, [target], CANVAS, 0, 0, 6)
    expect(res.guides[0].position).toBe(500)
    expect(res.dx).toBe(5)
  })

  it('resolves an equidistant layer-vs-layer tie in favour of the lower index', () => {
    // moving-left (200) is 5 from target1-left (195, -5) and 5 from target2-left
    // (205, +5). Equal |delta|, both layers -> lower index wins.
    const moving = box(200, 3000, 2000, 10)
    const t1 = box(195, 0, 22, 10)
    const t2 = box(205, 0, 22, 10)
    const res = computeSnap(moving, [t1, t2], CANVAS, 0, 0, 6)
    expect(res.guides[0].position).toBe(195)
    expect(res.dx).toBe(-5)
  })
})

describe('computeSnap — exactness & isolation', () => {
  it('snapped guide positions are exact QUANTIZE_STEP multiples', () => {
    // Even with a quarter-pixel centre, the guide lands on the half-pixel grid.
    const moving = box(100.25, 3000, 99.5, 10) // cx = 150 (quarter-pixel inputs)
    const target = box(150, 0, 10, 10)
    const res = computeSnap(moving, [target], CANVAS, 0, 0, 6)
    const guide = res.guides.find((g) => g.orientation === 'v')!
    expect(guide.position % QUANTIZE_STEP).toBe(0)
  })

  it('only uses the provided targets — a box NOT in targets is never snapped to', () => {
    // A near box at x=104 is deliberately excluded from `targets`.
    const moving = box(100, 3000, 50, 10)
    const res = computeSnap(moving, [], CANVAS, 0, 0, 6)
    expect(res.guides).toEqual([]) // canvas is far; the unpassed box is ignored
    expect(res.dx).toBe(0)
  })
})

describe('computeSnap — zoom-aware threshold', () => {
  it('a larger scale yields a SMALLER canvas-unit tolerance (snaps less)', () => {
    // delta of 4 from target-left: within threshold at scale 1 (6 px) but not at
    // scale 2 (3 px) — the same pointer motion stops snapping when zoomed in.
    const moving = box(296, 3000, 100, 10)
    const target = box(300, 0, 100, 10)
    const thrScale1 = SNAP_THRESHOLD_PX / 1
    const thrScale2 = SNAP_THRESHOLD_PX / 2
    const atScale1 = computeSnap(moving, [target], CANVAS, 0, 0, thrScale1)
    const atScale2 = computeSnap(moving, [target], CANVAS, 0, 0, thrScale2)
    expect(atScale1.guides).toHaveLength(1) // 4 <= 6 -> snaps
    expect(atScale2.guides).toHaveLength(0) // 4 > 3 -> free
  })
})
