import { describe, it, expect } from 'vitest'
import { applyDrag } from '../../src/canvas/useCanvasPointer'

/**
 * Pure movement-delta math for pointer dragging. Per plan §4, drag coordinates
 * are deliberately NOT clamped — off-canvas positions are allowed.
 */
describe('applyDrag', () => {
  it('adds canvas-unit deltas to the start position', () => {
    expect(applyDrag(10, 20, 5, -3)).toEqual({ x: 15, y: 17 })
  })

  it('zero delta leaves the position unchanged', () => {
    expect(applyDrag(100, 200, 0, 0)).toEqual({ x: 100, y: 200 })
  })

  it('does NOT clamp off-canvas (negative) positions', () => {
    expect(applyDrag(10, 10, -100, -200)).toEqual({ x: -90, y: -190 })
  })

  it('does NOT clamp positions far beyond the canvas', () => {
    expect(applyDrag(50, 50, 9999, 9999)).toEqual({ x: 10049, y: 10049 })
  })

  it('handles fractional deltas exactly', () => {
    expect(applyDrag(0, 0, 1.5, 2.25)).toEqual({ x: 1.5, y: 2.25 })
  })

  it('is pure: same inputs -> same outputs', () => {
    expect(applyDrag(7, 7, 3, 4)).toEqual(applyDrag(7, 7, 3, 4))
  })
})
