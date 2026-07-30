import { describe, it, expect } from 'vitest'
import {
  clampZoom,
  zoomAtPoint,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../../src/canvas/viewport'

/**
 * Phase 4 viewport math tests. Pure functions — no DOM — so the cursor-anchoring
 * and clamping behavior is pinned independently of the React wiring.
 */

describe('clampZoom', () => {
  it('clamps to the bounds', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(0.001)).toBe(MIN_ZOOM)
    expect(clampZoom(100)).toBe(MAX_ZOOM)
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(2.5)).toBe(2.5)
  })

  it('returns 1 for non-finite input (never NaN/Infinity)', () => {
    expect(clampZoom(NaN)).toBe(1)
    expect(clampZoom(Infinity)).toBe(1)
    expect(clampZoom(-Infinity)).toBe(1)
  })
})

describe('zoomAtPoint', () => {
  // Where on the canvas (origin-relative local coords) does a given screen
  // anchor land, under zoom + pan? screen = zoom*(local) + pan (origin-relative).
  const localUnder = (
    zoom: number,
    pan: { x: number; y: number },
    anchor: { x: number; y: number },
  ) => ({ x: (anchor.x - pan.x) / zoom, y: (anchor.y - pan.y) / zoom })

  it('keeps the anchor point fixed when zooming about it', () => {
    const zoom = 1
    const pan = { x: 0, y: 0 }
    const anchor = { x: 120, y: -40 }
    const before = localUnder(zoom, pan, anchor)

    const { zoom: z2, pan: p2 } = zoomAtPoint(zoom, pan, 2.5, anchor)
    const after = localUnder(z2, p2, anchor)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('keeps the anchor fixed even from a non-trivial starting pan/zoom', () => {
    const zoom = 1.5
    const pan = { x: 30, y: -20 }
    const anchor = { x: 200, y: 80 }
    const before = localUnder(zoom, pan, anchor)
    const { zoom: z2, pan: p2 } = zoomAtPoint(zoom, pan, 0.4, anchor)
    const after = localUnder(z2, p2, anchor)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('multiplies the zoom by the factor', () => {
    const r = zoomAtPoint(2, { x: 0, y: 0 }, 3, { x: 0, y: 0 })
    expect(r.zoom).toBe(6)
  })

  it('round-trips: zoom in by f then out by 1/f returns to the original pan', () => {
    const zoom0 = 1
    const pan0 = { x: 17, y: -9 }
    const anchor = { x: 250, y: 130 }
    const a = zoomAtPoint(zoom0, pan0, 2, anchor)
    const b = zoomAtPoint(a.zoom, a.pan, 1 / 2, anchor)
    expect(b.zoom).toBeCloseTo(zoom0, 9)
    expect(b.pan.x).toBeCloseTo(pan0.x, 9)
    expect(b.pan.y).toBeCloseTo(pan0.y, 9)
  })

  it('zooming about the center (anchor {0,0}) leaves the center fixed', () => {
    const r = zoomAtPoint(1, { x: 0, y: 0 }, 4, { x: 0, y: 0 })
    expect(r.pan).toEqual({ x: 0, y: 0 })
    expect(r.zoom).toBe(4)
  })

  it('clamps the zoom at the upper bound but still tracks the anchor', () => {
    const anchor = { x: 50, y: 50 }
    const { zoom, pan } = zoomAtPoint(1, { x: 0, y: 0 }, 1000, anchor)
    expect(zoom).toBe(MAX_ZOOM)
    const before = localUnder(1, { x: 0, y: 0 }, anchor)
    const after = localUnder(zoom, pan, anchor)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })
})
