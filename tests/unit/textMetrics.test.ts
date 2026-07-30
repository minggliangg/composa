import { describe, it, expect } from 'vitest'
import {
  normalizeTextContent,
  measureText,
  layoutText,
  textAlignAnchor,
  defaultTextFontSize,
  ADVANCE_RATIO,
  ASCENT_RATIO,
  LINE_HEIGHT_RATIO,
} from '../../src/text/textMetrics'
import { QUANTIZE_STEP } from '../../src/canvas/quantize'
import type { TextContent, CanvasConfig } from '../../src/types/layer'

/**
 * Pure unit tests for text metrics + layout (Step 5). Assertions are relative /
 * structural — they never hard-code the provisional ADVANCE_RATIO, so they hold
 * regardless of the exact value (the runtime Playwright test pins the absolute).
 */

function text(over: Partial<TextContent>): TextContent {
  return {
    content: 'Text',
    fontSize: 10,
    fontWeight: 400,
    italic: false,
    fill: '#000000',
    align: 'left',
    ...over,
  }
}

/** Assert a value is an exact integer multiple of QUANTIZE_STEP. */
function expectOnGrid(value: number): void {
  expect(value / QUANTIZE_STEP).toBe(Math.round(value / QUANTIZE_STEP))
}

describe('normalizeTextContent', () => {
  it('collapses \\r\\n and a lone \\r to a single line break', () => {
    expect(normalizeTextContent('a\r\nb')).toBe('a\nb')
    expect(normalizeTextContent('a\rb')).toBe('a\nb')
  })

  it('expands tabs to spaces (no defined monospace advance)', () => {
    expect(normalizeTextContent('a\tb')).toBe('a' + ' '.repeat(4) + 'b')
  })

  it('strips XML-invalid C0 control characters', () => {
    expect(normalizeTextContent('a\x00b\x07c')).toBe('abc')
    expect(normalizeTextContent('a\x0Bb')).toBe('ab') // VT stripped
    expect(normalizeTextContent('a\x1Fb')).toBe('ab') // US stripped
    // \t (\x09), \n (\x0A), \r (\x0D) are NOT in the strip set.
    expect(normalizeTextContent('a\tb')).toContain(' ')
  })

  it('is pure: does not mutate via shared state', () => {
    const input = 'a\x00b'
    expect(normalizeTextContent(input)).toBe('ab')
  })
})

describe('measureText', () => {
  it('returns a non-zero box for empty content (one-cell minimum)', () => {
    const m = measureText('', 10)
    expect(m.width).toBeGreaterThan(0)
    expect(m.height).toBeGreaterThan(0)
  })

  it('multi-line width tracks the LONGEST line, not the sum', () => {
    const multi = measureText('hi\nhello world\nok', 10)
    const longest = measureText('hello world', 10)
    const short = measureText('hi', 10)
    expect(multi.width).toBe(longest.width)
    expect(multi.width).toBeGreaterThan(short.width)
  })

  it('height scales with line count', () => {
    const one = measureText('x', 10).height
    const three = measureText('x\ny\nz', 10).height
    expect(three).toBeCloseTo(one * 3, 10)
  })

  it('width and height are exact QUANTIZE_STEP multiples (the isLayerResized guard)', () => {
    const m = measureText('hello world\nsecond line', 13)
    expectOnGrid(m.width)
    expectOnGrid(m.height)
  })

  it('treats \\r\\n as a single break (no double counting)', () => {
    expect(measureText('a\r\nb', 10)).toEqual(measureText('a\nb', 10))
  })

  it('scales (roughly) linearly with font size', () => {
    // Doubling the font size doubles the UNQUANTIZED width; the half-pixel
    // quantize can perturb each side by up to 0.25, so check a loose band.
    const a = measureText('hello', 10).width
    const b = measureText('hello', 20).width
    expect(b).toBeGreaterThan(a * 1.9)
    expect(b).toBeLessThan(a * 2.1)
  })
})

describe('layoutText', () => {
  it('first baseline at ASCENT_RATIO; lines step by fontSize × LINE_HEIGHT_RATIO', () => {
    const lines = layoutText(text({ content: 'a\nb\nc', fontSize: 10 }))
    expect(lines).toHaveLength(3)
    expect(lines[0].y).toBe(ASCENT_RATIO * 10)
    expect(lines[1].y - lines[0].y).toBe(10 * LINE_HEIGHT_RATIO)
    expect(lines[2].y - lines[1].y).toBe(10 * LINE_HEIGHT_RATIO)
  })

  it('produces one entry per line, in order, with the normalized text', () => {
    const lines = layoutText(text({ content: 'foo\r\nbar' }))
    expect(lines.map((l) => l.text)).toEqual(['foo', 'bar'])
  })

  it('left aligns to x=0', () => {
    const lines = layoutText(text({ content: 'a\nabcd', align: 'left' }))
    expect(lines.every((l) => l.x === 0)).toBe(true)
    expect(textAlignAnchor('left')).toBe('start')
  })

  it('center aligns every line to the box centre (block-relative)', () => {
    const t = text({ content: 'a\nabcd', align: 'center', fontSize: 10 })
    const lines = layoutText(t)
    const boxWidth = measureText(t.content, 10).width
    expect(lines.every((l) => l.x === boxWidth / 2)).toBe(true)
    expect(textAlignAnchor('center')).toBe('middle')
  })

  it('right aligns every line to the box right edge', () => {
    const t = text({ content: 'a\nabcd', align: 'right', fontSize: 10 })
    const lines = layoutText(t)
    const boxWidth = measureText(t.content, 10).width
    expect(lines.every((l) => l.x === boxWidth)).toBe(true)
    expect(textAlignAnchor('right')).toBe('end')
  })

  it('is pure + deterministic: identical input yields identical output', () => {
    const t = text({ content: 'hello\nworld' })
    expect(layoutText(t)).toEqual(layoutText(t))
  })
})

describe('defaultTextFontSize', () => {
  const canvas = (height: number): CanvasConfig => ({ width: height, height })
  it('clamps to [12, 200] and scales with canvas height', () => {
    expect(defaultTextFontSize(canvas(288))).toBe(12) // 288/24=12 (floor at min)
    expect(defaultTextFontSize(canvas(512))).toBe(Math.round(512 / 24))
    expect(defaultTextFontSize(canvas(9600))).toBe(200) // 9600/24=400 -> clamped
  })
})
