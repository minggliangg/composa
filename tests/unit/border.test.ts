import { describe, it, expect } from 'vitest'
import {
  borderRect,
  borderOuterRect,
  normalizeBorder,
  defaultBorder,
  hasBorder,
  DEFAULT_BORDER_COLOR,
  DEFAULT_BORDER_WIDTH,
  DEFAULT_BORDER_PADDING,
  MAX_BORDER_WIDTH,
  type BorderBox,
} from '../../src/canvas/border'

/** Build a box fixture. `borderRect(fixture) !== null` is asserted in setup —
 *  `tests/` is typechecked by nothing, so a typo like `{ colour: ... }` would
 *  otherwise pass vacuously. */
function box(
  x: number,
  y: number,
  width: number,
  height: number,
  border?: BorderBox['border'],
): BorderBox {
  return { x, y, width, height, border }
}

describe('defaultBorder', () => {
  it('is light grey / 1 / 0', () => {
    expect(defaultBorder()).toEqual({
      color: DEFAULT_BORDER_COLOR,
      width: DEFAULT_BORDER_WIDTH,
      padding: DEFAULT_BORDER_PADDING,
    })
    expect(DEFAULT_BORDER_COLOR).toBe('#cccccc')
    expect(DEFAULT_BORDER_WIDTH).toBe(1)
    expect(DEFAULT_BORDER_PADDING).toBe(0)
  })

  it('returns a fresh object each call (no shared mutable reference)', () => {
    expect(defaultBorder()).not.toBe(defaultBorder())
  })
})

describe('borderRect — null cases', () => {
  it('is null with no border', () => {
    expect(borderRect(box(100, 100, 200, 150))).toBeNull()
  })
  it('is null with border: null', () => {
    expect(borderRect(box(100, 100, 200, 150, null))).toBeNull()
  })
  it('is null with width: 0', () => {
    expect(
      borderRect(box(100, 100, 200, 150, { color: '#cccccc', width: 0, padding: 0 })),
    ).toBeNull()
  })
  it('is null with width: -1', () => {
    expect(
      borderRect(box(100, 100, 200, 150, { color: '#cccccc', width: -1, padding: 0 })),
    ).toBeNull()
  })
})

describe('borderRect — exact geometry', () => {
  it('flush border (p=0, t=1) hugs the box outward by t/2', () => {
    // path: 99.5 .. 300.5 on x; bands [99,100] and [300,301]; asset [100,300].
    const r = borderRect(
      box(100, 100, 200, 200, { color: '#cccccc', width: 1, padding: 0 }),
    )!
    expect(r).not.toBeNull()
    expect(r).toEqual({
      x: 99.5,
      y: 99.5,
      width: 201,
      height: 201,
      strokeWidth: 1,
      color: '#cccccc',
    })
  })

  it('padded border (p=4, t=2) grows by 2p + t', () => {
    const r = borderRect(
      box(100, 100, 200, 200, { color: '#cccccc', width: 2, padding: 4 }),
    )!
    expect(r.x).toBe(100 - 4 - 1) // 95
    expect(r.y).toBe(95)
    expect(r.width).toBe(200 + 2 * 4 + 2) // 210
    expect(r.height).toBe(210)
    expect(r.strokeWidth).toBe(2)
  })
})

describe('borderRect — the never-covers invariant (table-driven)', () => {
  // For each combination, the inner edge of every stroke band must sit exactly
  // on the padded box edge (=== x - p, etc.) and never cross into the asset
  // (≤ x / ≥ x+width, etc.). The stroke band straddles the path: its inner edge
  // on the left is r.x + t/2, on the right is (r.x + r.width) - t/2.
  const cases: { name: string; x: number; y: number; w: number; h: number; p: number; t: number }[] =
    [
      { name: 'flush hairline', x: 100, y: 80, w: 200, h: 150, p: 0, t: 1 },
      { name: 'padded', x: 100, y: 80, w: 200, h: 150, p: 4, t: 2 },
      { name: 'thick flush', x: 0, y: 0, w: 50, h: 50, p: 0, t: 6 },
      { name: 'thick padded', x: 250, y: 250, w: 100, h: 100, p: 10, t: 8 },
      { name: 'odd size', x: 33, y: 27, w: 71, h: 49, p: 0, t: 1 },
      { name: 'half-grid', x: 12.5, y: 7.5, w: 100.5, h: 88.5, p: 2.5, t: 1.5 },
      { name: 'large canvas', x: 0, y: 0, w: 4096, h: 4096, p: 0, t: 1 },
      { name: 'offset', x: 1234.5, y: 5678, w: 432, h: 210.5, p: 6, t: 3 },
    ]

  for (const c of cases) {
    it(`${c.name}: stroke inner edges sit on padded box edge, never inside`, () => {
      const r = borderRect(
        box(c.x, c.y, c.w, c.h, { color: '#cccccc', width: c.t, padding: c.p }),
      )!
      expect(r).not.toBeNull()
      const half = c.t / 2
      // Left: inner edge === x - p and <= x.
      expect(r.x + half).toBeCloseTo(c.x - c.p, 10)
      expect(r.x + half).toBeLessThanOrEqual(c.x)
      // Right: inner edge === x + w + p and >= x + w.
      expect(r.x + r.width - half).toBeCloseTo(c.x + c.w + c.p, 10)
      expect(r.x + r.width - half).toBeGreaterThanOrEqual(c.x + c.w)
      // Top: inner edge === y - p and <= y.
      expect(r.y + half).toBeCloseTo(c.y - c.p, 10)
      expect(r.y + half).toBeLessThanOrEqual(c.y)
      // Bottom: inner edge === y + h + p and >= y + h.
      expect(r.y + r.height - half).toBeCloseTo(c.y + c.h + c.p, 10)
      expect(r.y + r.height - half).toBeGreaterThanOrEqual(c.y + c.h)
      // Stroke width is the configured thickness.
      expect(r.strokeWidth).toBe(c.t)
    })
  }

  it('a hand-built padding: -50 is clamped and still outside-only', () => {
    const r = borderRect(
      box(100, 100, 200, 200, { color: '#cccccc', width: 1, padding: -50 }),
    )!
    expect(r).not.toBeNull()
    // padding clamped to 0 → behaves like a flush border.
    expect(r.x).toBe(99.5)
    expect(r.x + r.strokeWidth / 2).toBe(100) // exactly on the asset edge
  })
})

describe('borderRect — clean-decimal property', () => {
  it('every field is a multiple of 0.25 for grid-aligned inputs (no float noise)', () => {
    // x/y/w/h on the 0.5 grid, t/p on the 0.5 grid → every output is a multiple
    // of 0.25 (Number.isInteger(v * 4)).
    const gridInputs = [
      { x: 0, y: 0, w: 200, h: 150, p: 0, t: 1 },
      { x: 12.5, y: 7.5, w: 100.5, h: 88.5, p: 2.5, t: 1.5 },
      { x: 33, y: 27, w: 71, h: 49, p: 4, t: 2 },
      { x: 1234.5, y: 5678, w: 432, h: 210.5, p: 6, t: 3 },
    ]
    for (const c of gridInputs) {
      const r = borderRect(
        box(c.x, c.y, c.w, c.h, { color: '#cccccc', width: c.t, padding: c.p }),
      )!
      for (const v of [r.x, r.y, r.width, r.height, r.strokeWidth]) {
        expect(Number.isInteger(v * 4)).toBe(true)
      }
    }
  })
})

describe('borderOuterRect', () => {
  it('equals the box grown by padding + thickness', () => {
    const o = borderOuterRect(
      box(100, 100, 200, 200, { color: '#cccccc', width: 2, padding: 4 }),
    )
    // grow = p + t = 6
    expect(o).toEqual({ x: 94, y: 94, width: 212, height: 212 })
  })

  it('equals the box itself with no border', () => {
    expect(borderOuterRect(box(100, 100, 200, 200))).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    })
    expect(
      borderOuterRect(box(100, 100, 200, 200, { color: '#cccccc', width: 0, padding: 0 })),
    ).toEqual({ x: 100, y: 100, width: 200, height: 200 })
  })

  it('clamps a hand-built negative padding', () => {
    const o = borderOuterRect(
      box(100, 100, 200, 200, { color: '#cccccc', width: 2, padding: -50 }),
    )
    // padding clamped to 0 → grow = 2
    expect(o).toEqual({ x: 98, y: 98, width: 204, height: 204 })
  })
})

describe('normalizeBorder', () => {
  it('floors/caps/snaps width and padding (0.7 -> 0.5)', () => {
    expect(normalizeBorder({ color: '#cccccc', width: 0.7, padding: 0.7 })).toEqual({
      width: 0.5,
      padding: 0.5,
      color: '#cccccc',
    })
  })

  it('floors negative values at 0', () => {
    expect(
      normalizeBorder({ color: '#cccccc', width: -10, padding: -5 }),
    ).toEqual({ width: 0, padding: 0, color: '#cccccc' })
  })

  it('caps width at MAX_BORDER_WIDTH', () => {
    expect(
      normalizeBorder({ color: '#cccccc', width: 99999, padding: 0 }).width,
    ).toBe(MAX_BORDER_WIDTH)
  })

  it('falls back to the default colour for red / #abc / empty', () => {
    expect(normalizeBorder({ color: 'red', width: 1, padding: 0 }).color).toBe(
      DEFAULT_BORDER_COLOR,
    )
    expect(normalizeBorder({ color: '#abc', width: 1, padding: 0 }).color).toBe(
      DEFAULT_BORDER_COLOR,
    )
    expect(normalizeBorder({ color: '', width: 1, padding: 0 }).color).toBe(
      DEFAULT_BORDER_COLOR,
    )
  })

  it('lowercases a valid #rrggbb colour', () => {
    expect(
      normalizeBorder({ color: '#AABBCC', width: 1, padding: 0 }).color,
    ).toBe('#aabbcc')
  })

  it('full normalization through the seam', () => {
    expect(
      normalizeBorder({ padding: -5, width: 0.7, color: 'red' }),
    ).toEqual({ padding: 0, width: 0.5, color: DEFAULT_BORDER_COLOR })
  })
})

describe('hasBorder', () => {
  it('is false with no border / null border', () => {
    expect(hasBorder({})).toBe(false)
    expect(hasBorder({ border: null })).toBe(false)
    expect(hasBorder({ border: undefined })).toBe(false)
  })
  it('is true when a border is configured (even width 0)', () => {
    expect(
      hasBorder({ border: { color: '#cccccc', width: 0, padding: 0 } }),
    ).toBe(true)
    expect(
      hasBorder({ border: { color: '#cccccc', width: 4, padding: 2 } }),
    ).toBe(true)
  })
})
