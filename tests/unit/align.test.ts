import { describe, it, expect } from 'vitest'
import {
  alignToCanvas,
  alignToSelection,
  distribute,
} from '../../src/canvas/align'
import type { AlignRect } from '../../src/canvas/align'

/** Build a rect with a stable id and the given geometry. */
function rect(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 50,
): AlignRect {
  return { id, x, y, width, height }
}

/** Reduce a list of updates to a { id -> patch } map for concise assertions. */
function byId(updates: { id: string; patch: Record<string, number> }[]) {
  return Object.fromEntries(updates.map((u) => [u.id, u.patch]))
}

const CANVAS = { width: 1000, height: 800 }

describe('alignToCanvas', () => {
  it('left pins every rect to x=0', () => {
    const out = alignToCanvas(
      [rect('a', 120, 10), rect('b', 340, 90)],
      CANVAS,
      'left',
    )
    expect(byId(out)).toEqual({ a: { x: 0 }, b: { x: 0 } })
  })

  it('right pins every rect to canvas.width - width', () => {
    const out = alignToCanvas([rect('a', 120, 10)], CANVAS, 'right')
    // 1000 - 100 = 900
    expect(out[0].patch).toEqual({ x: 900 })
  })

  it('center-h centers each rect independently on the canvas', () => {
    const out = alignToCanvas([rect('a', 0, 0, 200, 100)], CANVAS, 'center-h')
    // (1000 - 200)/2 = 400
    expect(out[0].patch).toEqual({ x: 400 })
  })

  it('center-v / bottom operate on y', () => {
    expect(
      alignToCanvas([rect('a', 0, 0, 100, 200)], CANVAS, 'center-v')[0].patch,
    ).toEqual({ y: 300 }) // (800-200)/2
    expect(
      alignToCanvas([rect('a', 0, 0, 100, 200)], CANVAS, 'bottom')[0].patch,
    ).toEqual({ y: 600 }) // 800-200
  })
})

describe('alignToSelection', () => {
  // Two layers: a at x=100..300 (w=200), b at x=500..560 (w=60).
  // Selection bbox: minX=100, maxX=560, midX=330.
  const sel = [rect('a', 100, 0, 200, 50), rect('b', 500, 0, 60, 50)]

  it('left aligns every rect to the selection left edge (minX)', () => {
    expect(byId(alignToSelection(sel, 'left'))).toEqual({
      a: { x: 100 },
      b: { x: 100 },
    })
  })

  it('right aligns every rect to the selection right edge (maxX - width)', () => {
    expect(byId(alignToSelection(sel, 'right'))).toEqual({
      a: { x: 360 }, // 560 - 200
      b: { x: 500 }, // 560 - 60
    })
  })

  it('center-h centers each rect on the selection center (midX)', () => {
    expect(byId(alignToSelection(sel, 'center-h'))).toEqual({
      a: { x: 230 }, // 330 - 200/2
      b: { x: 300 }, // 330 - 60/2
    })
  })

  it('is a no-op for a single selected layer', () => {
    const single = [rect('a', 100, 100, 200, 50)]
    expect(byId(alignToSelection(single, 'left'))).toEqual({ a: { x: 100 } })
    expect(byId(alignToSelection(single, 'right'))).toEqual({ a: { x: 100 } })
    expect(byId(alignToSelection(single, 'center-h'))).toEqual({ a: { x: 100 } })
  })

  it('returns [] for empty input', () => {
    expect(alignToSelection([], 'left')).toEqual([])
  })
})

describe('distribute', () => {
  it('horizontal equalizes center spacing, keeping first/last centers fixed', () => {
    // Centers: a=150, b=250, c=650. first=150, last=650, step=(650-150)/2=250.
    // Targets: 150, 400, 650. Rects default w=100 => x=center-50.
    const items = [
      rect('a', 100, 0), // center 150
      rect('b', 200, 0), // center 250
      rect('c', 600, 0), // center 650
    ]
    expect(byId(distribute(items, 'horizontal'))).toEqual({
      a: { x: 100 }, // 150-50
      b: { x: 350 }, // 400-50
      c: { x: 600 }, // 650-50
    })
  })

  it('vertical distributes along y using each rect height', () => {
    const items = [
      rect('a', 0, 0, 100, 40), // center 20
      rect('b', 0, 300, 100, 40), // center 320
      rect('c', 0, 760, 100, 40), // center 780
    ]
    // first=20, last=780, step=380 => 20, 400, 780. y=center-20.
    expect(byId(distribute(items, 'vertical'))).toEqual({
      a: { y: 0 },
      b: { y: 380 },
      c: { y: 760 },
    })
  })

  it('returns [] for fewer than 2 rects', () => {
    expect(distribute([], 'horizontal')).toEqual([])
    expect(distribute([rect('a', 0, 0)], 'horizontal')).toEqual([])
  })
})
