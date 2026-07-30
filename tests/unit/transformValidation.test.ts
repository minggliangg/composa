/**
 * Unit tests for the transform-validation predicates in transformValidation.ts.
 *
 * `isLayerDistorted` (ratio drift) and `isLayerResized` (size drift) drive the
 * disabled state of the "Reset aspect" and "Reset to original size" buttons
 * respectively, so their edge cases — zero natural dims, exact-vs-epsilon
 * comparison, width-only vs height-only drift — are unit-tested here without
 * rendering any React.
 */
import { describe, it, expect } from 'vitest'
import type { Layer } from '../../src/types/layer'
import { createLayerId } from '../../src/types/layer'
import { isLayerDistorted, isLayerResized } from '../../src/panels/RightPanel/transformValidation'

/** Minimal layer with full control over natural + rendered dims. */
function layer(
  naturalWidth: number,
  naturalHeight: number,
  width: number,
  height: number,
): Layer {
  const id = createLayerId()
  return {
    id,
    originalFilename: 'o.png',
    name: null,
    mimeType: 'image/png',
    previewUrl: `blob:o-${id}`,
    fullResBytesRef: { kind: 'file', file: new File([], 'o.png') },
    x: 0,
    y: 0,
    width,
    height,
    naturalWidth,
    naturalHeight,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    visible: true,
    locked: false,
    isBaseImage: false,
  }
}

describe('isLayerResized', () => {
  it('returns true when rendered dims differ from natural dims', () => {
    expect(isLayerResized(layer(100, 100, 200, 200))).toBe(true)
    expect(isLayerResized(layer(100, 100, 50, 50))).toBe(true) // scaled down
  })

  it('returns false when rendered dims exactly match natural dims', () => {
    expect(isLayerResized(layer(100, 100, 100, 100))).toBe(false)
    expect(isLayerResized(layer(333, 217, 333, 217))).toBe(false)
  })

  it('returns true if EITHER dimension differs', () => {
    expect(isLayerResized(layer(100, 100, 100, 200))).toBe(true) // height only
    expect(isLayerResized(layer(100, 100, 200, 100))).toBe(true) // width only
  })

  it('returns false for layers with zero natural dims', () => {
    expect(isLayerResized(layer(0, 0, 200, 200))).toBe(false)
    expect(isLayerResized(layer(0, 100, 200, 200))).toBe(false)
    expect(isLayerResized(layer(100, 0, 200, 200))).toBe(false)
  })

  it('returns false for a text layer at its natural size (no epsilon needed)', () => {
    // Text natural dims are quantized on-grid, so a freshly created text layer
    // (rendered == natural) must read as "not resized" — the regression guard
    // for the measureText snapping rule.
    const id = createLayerId()
    const textLayer: Layer = {
      id,
      originalFilename: 'Text',
      name: null,
      mimeType: 'text/plain',
      previewUrl: '',
      fullResBytesRef: {
        kind: 'text',
        text: {
          content: 'Text',
          fontSize: 10,
          fontWeight: 400,
          italic: false,
          fill: '#000000',
          align: 'left',
        },
      },
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      naturalWidth: 100,
      naturalHeight: 100,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      visible: true,
      locked: false,
      isBaseImage: false,
    }
    expect(isLayerResized(textLayer)).toBe(false)
  })
})

describe('isLayerDistorted', () => {
  it('returns true when the rendered ratio drifts from the natural ratio', () => {
    // Natural 4:3, rendered 1:1.
    expect(isLayerDistorted(layer(400, 300, 200, 200))).toBe(true)
  })

  it('returns false when the ratio matches (even if scaled)', () => {
    // Natural 4:3, rendered 4:3 at a different size.
    expect(isLayerDistorted(layer(400, 300, 200, 150))).toBe(false)
    expect(isLayerDistorted(layer(400, 300, 800, 600))).toBe(false)
  })

  it('returns false for layers with zero natural dims', () => {
    expect(isLayerDistorted(layer(0, 0, 200, 200))).toBe(false)
  })
})
