import { describe, it, expect } from 'vitest'
import {
  alignToCanvas,
  alignToSelection,
  distribute,
  spaceEvenly,
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

describe('spaceEvenly', () => {
  it('returns [] for fewer than 2 rects', () => {
    expect(spaceEvenly([], 'horizontal', null)).toEqual([])
    expect(spaceEvenly([rect('a', 0, 0)], 'horizontal', null)).toEqual([])
    expect(spaceEvenly([rect('a', 0, 0)], 'horizontal', 10)).toEqual([])
  })

  it('auto: equal gaps with EQUAL sizes, outer bounds exactly preserved', () => {
    // Already even (gaps 100), so positions are unchanged: a no-op proof that
    // the math holds the outer bounds.
    const items = [rect('a', 0, 0), rect('b', 200, 0), rect('c', 400, 0)]
    const out = byId(spaceEvenly(items, 'horizontal', null))
    expect(out).toEqual({ a: { x: 0 }, b: { x: 200 }, c: { x: 400 } })
  })

  it('auto: equal gaps with UNEQUAL sizes, outer bounds exactly preserved', () => {
    // a w=100, b w=40, c w=100. Outer bounds 0..500. Equal gap = 130.
    const items = [
      rect('a', 0, 0, 100, 50),
      rect('b', 120, 0, 40, 50),
      rect('c', 400, 0, 100, 50),
    ]
    const out = byId(spaceEvenly(items, 'horizontal', null))
    expect(out).toEqual({ a: { x: 0 }, b: { x: 230 }, c: { x: 400 } })
    // Outer bounds preserved: first leading edge 0, last trailing edge 500.
    expect(out.a.x).toBe(0)
    expect(out.c.x + 100).toBe(500)
  })

  it('auto derives the gap from the MAX trailing edge, not the last-sorted rect', () => {
    // a starts first and is wide (trailing edge 300); c is last-sorted but narrow
    // (trailing edge 150). maxEdge must be 300 (a's), not 150 (c's).
    const items = [
      rect('a', 0, 0, 300, 50),
      rect('b', 50, 0, 50, 50),
      rect('c', 100, 0, 50, 50),
    ]
    const out = byId(spaceEvenly(items, 'horizontal', null))
    expect(out.a.x).toBe(0)
    // c's new trailing edge = x + 50 must reach 300, which only happens if
    // maxEdge was a's 300 (using c's 150 would land at 150).
    expect(out.c.x + 50).toBe(300)
  })

  it('auto: overlapping rects produce a negative step but keep bounds fixed', () => {
    const items = [
      rect('a', 0, 0, 100, 50),
      rect('b', 10, 0, 100, 50),
      rect('c', 20, 0, 100, 50),
    ]
    const out = byId(spaceEvenly(items, 'horizontal', null))
    // Outer bounds 0..120 preserved exactly.
    expect(out.a.x).toBe(0)
    expect(out.c.x + 100).toBe(120)
  })

  it('auto at n=2 pins the documented meaninglessness (first held, bounds fixed)', () => {
    const items = [rect('a', 0, 0, 100, 50), rect('b', 50, 0, 100, 50)]
    const out = byId(spaceEvenly(items, 'horizontal', null))
    expect(out.a.x).toBe(0)
    expect(out.b.x + 100).toBe(150) // maxEdge = 50+100
  })

  it('fixed gap 12 places exactly 12 units between rects, first x unchanged', () => {
    const items = [
      rect('a', 0, 0, 100, 50),
      rect('b', 200, 0, 50, 50),
      rect('c', 300, 0, 80, 50),
    ]
    const out = byId(spaceEvenly(items, 'horizontal', 12))
    expect(out).toEqual({ a: { x: 0 }, b: { x: 112 }, c: { x: 174 } })
    // Gaps: 112-100=12, 174-(112+50)=12.
    expect(out.b.x - 100).toBe(12)
    expect(out.c.x - (out.b.x + 50)).toBe(12)
  })

  it('fixed gap 0 abuts rects edge to edge', () => {
    const out = byId(
      spaceEvenly([rect('a', 0, 0, 100, 50), rect('b', 200, 0, 50, 50)], 'horizontal', 0),
    )
    expect(out).toEqual({ a: { x: 0 }, b: { x: 100 } })
  })

  it('fixed gap -10 is applied unclamped (deliberate, negative gap)', () => {
    const out = byId(
      spaceEvenly([rect('a', 0, 0, 100, 50), rect('b', 200, 0, 50, 50)], 'horizontal', -10),
    )
    expect(out).toEqual({ a: { x: 0 }, b: { x: 90 } }) // 90 - 100 = -10
  })

  it('vertical mirrors horizontal and patches carry only y', () => {
    const items = [
      rect('a', 0, 0, 50, 100),
      rect('b', 0, 200, 50, 50),
      rect('c', 0, 300, 50, 80),
    ]
    const out = spaceEvenly(items, 'vertical', 12)
    // Every patch has exactly one key: 'y' (never 'x').
    expect(out.every((u) => Object.keys(u.patch).length === 1)).toBe(true)
    expect(out.every((u) => Object.keys(u.patch)[0] === 'y')).toBe(true)
    expect(byId(out)).toEqual({ a: { y: 0 }, b: { y: 112 }, c: { y: 174 } })
  })

  it('is deterministic across three input permutations', () => {
    const a = rect('a', 0, 0, 100, 50)
    const b = rect('b', 120, 0, 40, 50)
    const c = rect('c', 400, 0, 100, 50)
    const perms = [
      [a, b, c],
      [c, a, b],
      [b, c, a],
    ]
    const results = perms.map((p) => byId(spaceEvenly(p, 'horizontal', null)))
    expect(results[0]).toEqual(results[1])
    expect(results[1]).toEqual(results[2])
  })
})
