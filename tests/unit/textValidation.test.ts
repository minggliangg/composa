import { describe, it, expect } from 'vitest'
import {
  parseHexColor,
  clampFontSize,
  FONT_WEIGHTS,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from '../../src/panels/RightPanel/textValidation'

/**
 * Pure unit tests for the text-control validation helpers (Step 8).
 */

describe('parseHexColor', () => {
  it('accepts a 6-digit hex with # and lowercases it', () => {
    expect(parseHexColor('#ffffff')).toBe('#ffffff')
    expect(parseHexColor('#0F1F2F')).toBe('#0f1f2f')
  })

  it('accepts a 6-digit hex without the leading #', () => {
    expect(parseHexColor('abcdef')).toBe('#abcdef')
  })

  it('expands a 3-digit hex to 6 digits', () => {
    expect(parseHexColor('#abc')).toBe('#aabbcc')
    expect(parseHexColor('FFF')).toBe('#ffffff')
  })

  it('trims surrounding whitespace', () => {
    expect(parseHexColor('  #fff  ')).toBe('#ffffff')
  })

  it('returns null for malformed input', () => {
    expect(parseHexColor('nope')).toBeNull()
    expect(parseHexColor('#12')).toBeNull() // too short
    expect(parseHexColor('#12345')).toBeNull() // 5 digits
    expect(parseHexColor('#gggggg')).toBeNull() // non-hex
    expect(parseHexColor('#1234567')).toBeNull() // too long
    expect(parseHexColor('')).toBeNull()
  })
})

describe('clampFontSize', () => {
  it('leaves in-range values unchanged', () => {
    expect(clampFontSize(50)).toBe(50)
    expect(clampFontSize(12.5)).toBe(12.5)
  })

  it('clamps values at or below zero to the minimum', () => {
    expect(clampFontSize(0)).toBe(MIN_FONT_SIZE)
    expect(clampFontSize(-5)).toBe(MIN_FONT_SIZE)
  })

  it('clamps oversized values to the maximum', () => {
    expect(clampFontSize(99999)).toBe(MAX_FONT_SIZE)
  })

  it('rejects NaN (the resize math would otherwise divide by nothing)', () => {
    expect(clampFontSize(NaN)).toBe(MIN_FONT_SIZE)
    expect(clampFontSize(Infinity)).toBe(MAX_FONT_SIZE)
  })
})

describe('FONT_WEIGHTS', () => {
  it('spans the variable axis 200..800 ascending', () => {
    expect(FONT_WEIGHTS[0]).toBe(200)
    expect(FONT_WEIGHTS[FONT_WEIGHTS.length - 1]).toBe(800)
    expect([...FONT_WEIGHTS]).toEqual(
      [...FONT_WEIGHTS].sort((a, b) => a - b),
    )
  })
})
