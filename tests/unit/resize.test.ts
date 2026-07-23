import { describe, it, expect } from 'vitest'
import { applyResize, MIN_LAYER_SIZE } from '../../src/canvas/resize'
import type { ResizeHandleId, ResizeStart } from '../../src/canvas/resize'

/**
 * Table-driven unit tests for the resize math (plan §4 / Phase 05).
 *
 * START rect: x=100, y=100, width=80, height=40, natural 80x40 (aspect 2:1).
 * The start rect already matches the natural aspect ratio, which keeps the
 * exact expected rects integral and easy to reason about.
 */
const START: ResizeStart = {
  x: 100,
  y: 100,
  width: 80,
  height: 40,
  naturalWidth: 80,
  naturalHeight: 40,
}

interface Case {
  name: string
  handle: ResizeHandleId
  pointer: { x: number; y: number }
  expected: { x: number; y: number; width: number; height: number }
}

// Exact rects for one representative drag per handle. Corner cases preserve the
// 2:1 aspect ratio (width == 2*height); edge cases change exactly one dim.
const CASES: Case[] = [
  // --- corners (aspect-preserving, anchor = opposite corner) ---
  {
    name: 'se dominant-y keeps top-left anchor',
    handle: 'se',
    pointer: { x: 260, y: 220 },
    expected: { x: 100, y: 100, width: 240, height: 120 },
  },
  {
    name: 'se dominant-x keeps top-left anchor',
    handle: 'se',
    pointer: { x: 300, y: 140 },
    expected: { x: 100, y: 100, width: 200, height: 100 },
  },
  {
    name: 'nw keeps bottom-right anchor',
    handle: 'nw',
    pointer: { x: 20, y: 60 },
    expected: { x: 20, y: 60, width: 160, height: 80 },
  },
  {
    name: 'ne keeps bottom-left anchor',
    handle: 'ne',
    pointer: { x: 260, y: 40 },
    expected: { x: 100, y: 40, width: 200, height: 100 },
  },
  {
    name: 'sw keeps top-right anchor',
    handle: 'sw',
    pointer: { x: 60, y: 200 },
    expected: { x: -20, y: 100, width: 200, height: 100 },
  },
  // --- edges (single-axis free resize) ---
  {
    name: 'e grows width, leaves x/y/height',
    handle: 'e',
    pointer: { x: 260, y: 999 },
    expected: { x: 100, y: 100, width: 160, height: 40 },
  },
  {
    name: 'w grows width, pins right edge',
    handle: 'w',
    pointer: { x: 60, y: 999 },
    expected: { x: 60, y: 100, width: 120, height: 40 },
  },
  {
    name: 's grows height, leaves x/y/width',
    handle: 's',
    pointer: { x: 999, y: 200 },
    expected: { x: 100, y: 100, width: 80, height: 100 },
  },
  {
    name: 'n grows height, pins bottom edge',
    handle: 'n',
    pointer: { x: 999, y: 60 },
    expected: { x: 100, y: 60, width: 80, height: 80 },
  },
]

describe('applyResize — table', () => {
  for (const c of CASES) {
    it(`${c.handle}: ${c.name}`, () => {
      const r = applyResize(c.handle, START, c.pointer)
      expect(r).toEqual(c.expected)
      // Hard invariants for every handle.
      expect(r.width).toBeGreaterThanOrEqual(0)
      expect(r.height).toBeGreaterThan(0)
    })
  }
})

describe('applyResize — corners preserve aspect ratio', () => {
  const cornerHandles: ResizeHandleId[] = ['nw', 'ne', 'se', 'sw']
  const pointers = [
    { x: 260, y: 220 },
    { x: 300, y: 140 },
    { x: 20, y: 60 },
    { x: 260, y: 40 },
    { x: 60, y: 200 },
    { x: 180, y: 180 },
  ]
  for (const handle of cornerHandles) {
    for (const pointer of pointers) {
      it(`${handle} @ (${pointer.x},${pointer.y}) keeps width/height == 2`, () => {
        const r = applyResize(handle, START, pointer)
        expect(r.width / r.height).toBeCloseTo(2, 6)
        expect(r.width).toBeGreaterThanOrEqual(MIN_LAYER_SIZE)
        expect(r.height).toBeGreaterThan(0)
      })
    }
  }

  it('preserves a non-integer aspect ratio (3:1)', () => {
    const start: ResizeStart = {
      x: 0,
      y: 0,
      width: 120,
      height: 40,
      naturalWidth: 120,
      naturalHeight: 40,
    }
    const r = applyResize('se', start, { x: 360, y: 120 })
    // dominant: scaleX=3, scaleY=3 -> tie -> x wins -> w=360, h=120
    expect(r.width / r.height).toBeCloseTo(3, 6)
  })
})

describe('applyResize — edge handles touch only one dimension', () => {
  it('e and w leave height unchanged', () => {
    const e = applyResize('e', START, { x: 999, y: 0 })
    const w = applyResize('w', START, { x: 0, y: 0 })
    expect(e.height).toBe(START.height)
    expect(w.height).toBe(START.height)
    expect(e.y).toBe(START.y)
    expect(w.y).toBe(START.y)
  })

  it('n and s leave width unchanged', () => {
    const n = applyResize('n', START, { x: 0, y: 0 })
    const s = applyResize('s', START, { x: 0, y: 999 })
    expect(n.width).toBe(START.width)
    expect(s.width).toBe(START.width)
    expect(n.x).toBe(START.x)
    expect(s.x).toBe(START.x)
  })
})

describe('applyResize — MIN_LAYER_SIZE floor (no flip, no negatives)', () => {
  it('e clamps width to MIN when shrunk past the floor', () => {
    const r = applyResize('e', START, { x: 105, y: 0 })
    expect(r.width).toBe(MIN_LAYER_SIZE)
    expect(r.x).toBe(START.x)
    expect(r.height).toBe(START.height)
  })

  it('e never goes negative when dragged past the left edge', () => {
    const r = applyResize('e', START, { x: 50, y: 0 })
    expect(r.width).toBe(MIN_LAYER_SIZE)
    expect(r.x).toBe(START.x)
  })

  it('w clamps width to MIN and keeps the right edge pinned when flipped', () => {
    const r = applyResize('w', START, { x: 300, y: 0 })
    expect(r.width).toBe(MIN_LAYER_SIZE)
    expect(r.x + r.width).toBe(START.x + START.width) // right edge pinned
  })

  it('s clamps height to MIN when shrunk past the floor', () => {
    const r = applyResize('s', START, { x: 0, y: 105 })
    expect(r.height).toBe(MIN_LAYER_SIZE)
    expect(r.y).toBe(START.y)
  })

  it('n clamps height to MIN and keeps the bottom edge pinned when flipped', () => {
    const r = applyResize('n', START, { x: 0, y: 300 })
    expect(r.height).toBe(MIN_LAYER_SIZE)
    expect(r.y + r.height).toBe(START.y + START.height) // bottom edge pinned
  })

  it('corner clamps width to MIN (no flip) and still preserves aspect', () => {
    // SE pointer dragged up-left of the anchor (100,100): scale goes negative.
    const r = applyResize('se', START, { x: 90, y: 90 })
    expect(r.width).toBe(MIN_LAYER_SIZE) // 20
    expect(r.height).toBe(MIN_LAYER_SIZE / 2) // 10, aspect preserved
    expect(r.width / r.height).toBeCloseTo(2, 6)
    expect(r.x).toBe(START.x) // anchor stays put
    expect(r.y).toBe(START.y)
    expect(r.height).toBeGreaterThan(0)
  })
})

describe('applyResize — idempotent anchors', () => {
  it('every corner keeps its opposite corner exactly fixed', () => {
    // se: top-left (x,y) fixed
    const se = applyResize('se', START, { x: 300, y: 140 })
    expect(se.x).toBe(START.x)
    expect(se.y).toBe(START.y)
    // nw: bottom-right (x+w, y+h) fixed
    const nw = applyResize('nw', START, { x: 20, y: 60 })
    expect(nw.x + nw.width).toBe(START.x + START.width)
    expect(nw.y + nw.height).toBe(START.y + START.height)
    // ne: bottom-left (x, y+h) fixed
    const ne = applyResize('ne', START, { x: 260, y: 40 })
    expect(ne.x).toBe(START.x)
    expect(ne.y + ne.height).toBe(START.y + START.height)
    // sw: top-right (x+w, y) fixed
    const sw = applyResize('sw', START, { x: 60, y: 200 })
    expect(sw.x + sw.width).toBe(START.x + START.width)
    expect(sw.y).toBe(START.y)
  })
})
