import { describe, it, expect } from 'vitest'
import { createFrameLayer, DEFAULT_FRAME_PADDING } from '../../src/composition/frameLayer'
import { MIN_LAYER_SIZE } from '../../src/canvas/resize'
import type { Layer } from '../../src/types/layer'
import { createLayerId } from '../../src/types/layer'

/** Build an overlay layer at the given box (no border by default). */
function overlay(
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<Layer> = {},
): Layer {
  const id = createLayerId()
  return {
    id,
    originalFilename: 'o.png',
    name: null,
    mimeType: 'image/png',
    previewUrl: `blob:${id}`,
    fullResBytesRef: { kind: 'file', file: new File([], 'o.png') },
    x,
    y,
    width,
    height,
    naturalWidth: width,
    naturalHeight: height,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    visible: true,
    locked: false,
    isBaseImage: false,
    ...extra,
  }
}

describe('createFrameLayer', () => {
  it('returns null for an empty list', () => {
    expect(createFrameLayer([])).toBeNull()
  })

  it('encloses the bbox of the layers with the padding in border.padding (not the box)', () => {
    const layers = [
      overlay(100, 100, 200, 150),
      overlay(400, 300, 100, 100),
      overlay(50, 500, 80, 60),
    ]
    const frame = createFrameLayer(layers)!
    expect(frame).not.toBeNull()
    // Box is the plain bbox (min/max over the boxes, no border growth here).
    expect(frame.x).toBe(50)
    expect(frame.y).toBe(100)
    expect(frame.width).toBe(450) // 500 - 50
    expect(frame.height).toBe(460) // 560 - 100
    // The padding lives on the border, NOT baked into the box.
    expect(frame.border).toBeDefined()
    expect(frame.border!.padding).toBe(DEFAULT_FRAME_PADDING)
  })

  it('a member with a border expands the bbox by padding + width on that side', () => {
    // The single member has a border { width: 4, padding: 6 } → grow = 10 each
    // side via borderOuterRect. The frame box encloses the OUTER bounds.
    const member = overlay(100, 100, 200, 150, {
      border: { color: '#cccccc', width: 4, padding: 6 },
    })
    const frame = createFrameLayer([member], { padding: 0 })!
    expect(frame.x).toBe(100 - 10) // 90
    expect(frame.y).toBe(100 - 10) // 90
    expect(frame.width).toBe(200 + 20) // 220
    expect(frame.height).toBe(150 + 20) // 170
  })

  it('floors the box dimensions at MIN_LAYER_SIZE', () => {
    // Two tiny, coincident layers → zero span → floored at MIN_LAYER_SIZE.
    const frame = createFrameLayer([overlay(50, 50, 1, 1), overlay(50, 50, 1, 1)])!
    expect(frame.width).toBe(MIN_LAYER_SIZE)
    expect(frame.height).toBe(MIN_LAYER_SIZE)
  })

  it('sets the expected identity fields', () => {
    const frame = createFrameLayer([overlay(0, 0, 100, 100)])!
    expect(frame.originalFilename).toBe('Frame')
    expect(frame.name).toBeNull()
    expect(frame.mimeType).toBe('image/svg+xml')
    expect(frame.previewUrl).toBe('')
    // naturalWidth/Height equal the box dims (reset buttons stay inert).
    expect(frame.naturalWidth).toBe(frame.width)
    expect(frame.naturalHeight).toBe(frame.height)
    // It is a transparent rect frame.
    expect(frame.fullResBytesRef).toEqual({ kind: 'rect', fill: null })
    expect(frame.isBaseImage).toBe(false)
  })

  it('honours a custom padding in border.padding', () => {
    const frame = createFrameLayer([overlay(0, 0, 100, 100)], { padding: 12 })!
    expect(frame.border!.padding).toBe(12)
  })

  it('passes a custom fill through to the rect payload', () => {
    const frame = createFrameLayer([overlay(0, 0, 100, 100)], { fill: '#ff0000' })!
    expect(frame.fullResBytesRef).toEqual({ kind: 'rect', fill: '#ff0000' })
  })
})
