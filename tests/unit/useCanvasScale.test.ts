import { describe, it, expect } from 'vitest'
import { computeCanvasScale } from '../../src/canvas/useCanvasScale'

describe('computeCanvasScale', () => {
  it('returns 1 for degenerate inputs (no divide-by-zero)', () => {
    expect(computeCanvasScale({ width: 0, height: 0 }, { width: 100, height: 100 })).toBe(1)
    expect(computeCanvasScale({ width: 100, height: 100 }, { width: 0, height: 100 })).toBe(1)
  })

  it('returns the fit ratio when the element matches the canvas aspect', () => {
    // A 100x100 canvas shown in a 400x400 box => 4 screen px per canvas unit.
    expect(computeCanvasScale({ width: 400, height: 400 }, { width: 100, height: 100 })).toBe(4)
  })

  it('uses the smaller axis (meet letterboxing guards against overflow)', () => {
    // 200x100 canvas in a 400x400 box: width fits at 2x, height would need 4x —
    // meet keeps the smaller (2x) so content fits entirely.
    expect(computeCanvasScale({ width: 400, height: 400 }, { width: 200, height: 100 })).toBe(2)
  })

  it('returns 1 when the box exactly matches the canvas (1:1)', () => {
    expect(computeCanvasScale({ width: 800, height: 600 }, { width: 800, height: 600 })).toBe(1)
  })
})
