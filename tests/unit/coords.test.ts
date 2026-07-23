import { describe, it, expect } from 'vitest'
import { convertViaMatrix } from '../../src/canvas/coords'
import type { AffineMatrix } from '../../src/canvas/coords'

/**
 * Unit tests for the pure screen→canvas conversion math. These construct
 * literal affine matrices (the same six components a real `DOMMatrix` exposes)
 * rather than touching a live SVG, so they run under jsdom — which notably does
 * NOT implement `DOMMatrix` at all.
 */
describe('convertViaMatrix', () => {
  it('identity matrix returns the input point unchanged', () => {
    const identity: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    expect(convertViaMatrix(123, 456, identity)).toEqual({ x: 123, y: 456 })
  })

  it('pure translate maps the screen origin to the canvas origin', () => {
    // Canvas (0,0) sits at screen (10,20).
    const m: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }
    expect(convertViaMatrix(10, 20, m)).toEqual({ x: 0, y: 0 })
    expect(convertViaMatrix(60, 70, m)).toEqual({ x: 50, y: 50 })
  })

  it('pure scale inverts by the scale factor on each axis', () => {
    const m: AffineMatrix = { a: 2, b: 0, c: 0, d: 4, e: 0, f: 0 }
    expect(convertViaMatrix(20, 40, m)).toEqual({ x: 10, y: 10 })
  })

  it('scale + translate combined (typical SVG fit)', () => {
    // 2x uniform scale, canvas origin shifted to screen (5,5).
    const m: AffineMatrix = { a: 2, b: 0, c: 0, d: 2, e: 5, f: 5 }
    // screen (25,25) -> ((25-5)/2, (25-5)/2) = (10,10)
    expect(convertViaMatrix(25, 25, m)).toEqual({ x: 10, y: 10 })
  })

  it('matches a hand-computed scaled+shifted case at multiple points', () => {
    const m: AffineMatrix = { a: 3, b: 0, c: 0, d: 3, e: 9, f: -6 }
    // inverse scale = 1/3, inverse translate = (-9/3, 6/3) = (-3, 2)
    // point (x,y) -> ((x-9)/3, (y+6)/3)
    expect(convertViaMatrix(9, -6, m)).toEqual({ x: 0, y: 0 })
    expect(convertViaMatrix(39, 24, m)).toEqual({ x: 10, y: 10 })
  })

  it('returns the raw point for a singular (non-invertible) matrix', () => {
    const m: AffineMatrix = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }
    expect(convertViaMatrix(7, 9, m)).toEqual({ x: 7, y: 9 })
  })

  it('is pure: the same inputs always yield the same outputs', () => {
    const m: AffineMatrix = { a: 1.5, b: 0, c: 0, d: 2.5, e: 12, f: -4 }
    const a = convertViaMatrix(42, 17, m)
    const b = convertViaMatrix(42, 17, m)
    expect(a).toEqual(b)
  })
})
