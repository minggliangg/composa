import { describe, it, expect } from 'vitest'
import { quantize, quantizePatch, QUANTIZE_STEP } from '../../src/canvas/quantize'

describe('quantize', () => {
  it('exposes a half-pixel default step', () => {
    expect(QUANTIZE_STEP).toBe(0.5)
  })

  it('rounds to the nearest half', () => {
    expect(quantize(12.7)).toBe(12.5)
    expect(quantize(12.3)).toBe(12.5)
    expect(quantize(12.2)).toBe(12)
    expect(quantize(12.49)).toBe(12.5)
    expect(quantize(12.51)).toBe(12.5)
  })

  it('leaves already-aligned values untouched', () => {
    expect(quantize(0)).toBe(0)
    expect(quantize(12)).toBe(12)
    expect(quantize(12.5)).toBe(12.5)
    expect(quantize(13)).toBe(13)
  })

  it('rounds negatives symmetrically', () => {
    expect(quantize(-12.7)).toBe(-12.5)
    expect(quantize(-12.2)).toBe(-12)
  })

  it('does not introduce floating-point noise', () => {
    // Half-pixel results must be exact (no 12.500000000001).
    const result = quantize(123.456789)
    expect(result).toBe(123.5)
    expect(Number.isFinite(result)).toBe(true)
  })

  it('supports an explicit step', () => {
    expect(quantize(13, 4)).toBe(12)
    expect(quantize(15, 4)).toBe(16)
  })
})

describe('quantizePatch', () => {
  it('rounds every present field and leaves absent ones out', () => {
    expect(quantizePatch({ x: 12.7, width: 33.2 })).toEqual({ x: 12.5, width: 33 })
  })

  it('returns an empty patch for an empty input', () => {
    expect(quantizePatch({})).toEqual({})
  })

  it('handles a partial patch covering only one axis', () => {
    expect(quantizePatch({ y: -7.6 })).toEqual({ y: -7.5 })
  })

  it('rounds all four fields', () => {
    expect(quantizePatch({ x: 1.2, y: 2.3, width: 3.4, height: 4.6 })).toEqual({
      x: 1,
      y: 2.5,
      width: 3.5,
      height: 4.5,
    })
  })
})
