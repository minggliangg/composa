import { describe, it, expect, beforeEach } from 'vitest'
import {
  createBlankBaseLayer,
  blankBasePreviewUrl,
  BLANK_BASE_SIZES,
} from '../../src/composition/blankBase'
import { useCompositionStore } from '../../src/state/compositionStore'
import { createLayerId } from '../../src/types/layer'
import type { Layer } from '../../src/types/layer'

/**
 * Phase 2 blank-base template tests. A blank base is a synthetic `Layer`
 * handed to the existing `setBaseImage` action — so the assertions cover both
 * the layer shape and that it flows through the store untouched (canvas adopts
 * the size, overlays survive).
 */

function makeBaseLayer(naturalWidth: number, naturalHeight: number, id = createLayerId()): Layer {
  return {
    id,
    originalFilename: 'base.png',
    name: null,
    mimeType: 'image/png',
    previewUrl: `blob:base-${id}`,
    fullResBytesRef: { kind: 'file', file: new File([], 'base.png') },
    x: 0,
    y: 0,
    width: naturalWidth,
    height: naturalHeight,
    naturalWidth,
    naturalHeight,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    visible: true,
    locked: false,
    isBaseImage: true,
  }
}

function makeOverlayLayer(id = createLayerId()): Layer {
  return {
    id,
    originalFilename: 'overlay.png',
    name: null,
    mimeType: 'image/png',
    previewUrl: `blob:overlay-${id}`,
    fullResBytesRef: { kind: 'file', file: new File([], 'overlay.png') },
    x: 10,
    y: 10,
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
}

beforeEach(() => {
  useCompositionStore.getState().resetComposition()
  useCompositionStore.temporal.getState().clear()
})

describe('BLANK_BASE_SIZES', () => {
  it('offers the documented 1:1 sizes', () => {
    expect([...BLANK_BASE_SIZES]).toEqual([512, 1024, 2048, 4096])
  })
})

describe('createBlankBaseLayer', () => {
  it('produces a blank-base layer for every offered size', () => {
    for (const size of BLANK_BASE_SIZES) {
      const layer = createBlankBaseLayer(size)
      expect(layer.isBaseImage).toBe(true)
      expect(layer.originalFilename).toBe(`blank-${size}.svg`)
      expect(layer.mimeType).toBe('image/svg+xml')
      expect(layer.naturalWidth).toBe(size)
      expect(layer.naturalHeight).toBe(size)
      expect(layer.width).toBe(size)
      expect(layer.height).toBe(size)
      expect(layer.fullResBytesRef).toEqual({ kind: 'blank', fill: '#ffffff' })
      // preview is a data URI (nothing to revoke), not a blob.
      expect(layer.previewUrl.startsWith('data:image/svg+xml,')).toBe(true)
      expect(layer.id).toMatch(/^[0-9a-f-]{36}$/)
    }
  })

  it('the preview data URI decodes to a white-filled square', () => {
    const layer = createBlankBaseLayer(512)
    const decoded = decodeURIComponent(layer.previewUrl.slice('data:image/svg+xml,'.length))
    const doc = new DOMParser().parseFromString(decoded, 'image/svg+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    const rect = doc.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('#ffffff')
    expect(rect?.getAttribute('width')).toBe('512')
  })

  it('produces a TRANSPARENT blank base when fill is null', () => {
    const layer = createBlankBaseLayer(512, null)
    expect(layer.fullResBytesRef).toEqual({ kind: 'blank', fill: null })
    // The preview still carries the rect — with fill="none", so it paints
    // nothing and the editor checkerboard shows through.
    const decoded = decodeURIComponent(layer.previewUrl.slice('data:image/svg+xml,'.length))
    const doc = new DOMParser().parseFromString(decoded, 'image/svg+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.querySelector('rect')?.getAttribute('fill')).toBe('none')
    // The exact payload shape is asserted elsewhere; here we pin that NO extra
    // discriminator field sneaks in alongside kind+fill.
    expect(Object.keys(layer.fullResBytesRef).sort()).toEqual(['fill', 'kind'])
  })
})

describe('createBlankBaseLayer through setBaseImage', () => {
  it('canvas adopts the blank size and existing overlays survive', () => {
    // Seed an existing base + overlay.
    useCompositionStore.getState().setBaseImage(makeBaseLayer(100, 100))
    const overlay = makeOverlayLayer('ovl')
    useCompositionStore.getState().addOverlay(overlay)
    expect(useCompositionStore.getState().layers).toHaveLength(2)

    // Replace the base with a blank 2048 canvas.
    useCompositionStore.getState().setBaseImage(createBlankBaseLayer(2048))

    const state = useCompositionStore.getState()
    expect(state.canvas).toEqual({ width: 2048, height: 2048 })
    // The overlay survived the base swap.
    expect(state.layers.some((l) => l.id === 'ovl')).toBe(true)
    // The new base leads at z-index 0.
    const newBase = state.layers.find((l) => l.isBaseImage)
    expect(newBase?.fullResBytesRef).toEqual({ kind: 'blank', fill: '#ffffff' })
    expect(newBase?.zIndex).toBe(0)
  })
})

describe('setBaseBackground', () => {
  it('toggles a blank base between white and transparent, refreshing the preview', () => {
    useCompositionStore.getState().setBaseImage(createBlankBaseLayer(256))
    const before = useCompositionStore.getState().layers.find((l) => l.isBaseImage)!

    useCompositionStore.getState().setBaseBackground(null)
    let base = useCompositionStore.getState().layers.find((l) => l.isBaseImage)!
    expect(base.fullResBytesRef).toEqual({ kind: 'blank', fill: null })
    // Preview rebuilt via the SAME helper that created it — no drift possible.
    expect(base.previewUrl).toBe(blankBasePreviewUrl(256, null))
    expect(base.previewUrl).not.toBe(before.previewUrl)

    useCompositionStore.getState().setBaseBackground('#ffffff')
    base = useCompositionStore.getState().layers.find((l) => l.isBaseImage)!
    expect(base.fullResBytesRef).toEqual({ kind: 'blank', fill: '#ffffff' })
    expect(base.previewUrl).toBe(before.previewUrl)
  })

  it('is a no-op for an uploaded (file) base — pixels are not editable', () => {
    useCompositionStore.getState().setBaseImage(makeBaseLayer(100, 100))
    const before = useCompositionStore.getState().layers
    useCompositionStore.getState().setBaseBackground(null)
    // Same array ref: the no-op returns the previous state, so no re-render
    // and no history entry.
    expect(useCompositionStore.getState().layers).toBe(before)
  })

  it('is a no-op with no base at all', () => {
    const before = useCompositionStore.getState().layers
    useCompositionStore.getState().setBaseBackground(null)
    expect(useCompositionStore.getState().layers).toBe(before)
    expect(useCompositionStore.temporal.getState().pastStates).toHaveLength(0)
  })

  it('is a no-op when the fill is unchanged', () => {
    useCompositionStore.getState().setBaseImage(createBlankBaseLayer(256))
    const before = useCompositionStore.getState().layers
    useCompositionStore.getState().setBaseBackground('#ffffff')
    expect(useCompositionStore.getState().layers).toBe(before)
  })

  it('registers as a single undo step and undoes cleanly', () => {
    useCompositionStore.getState().setBaseImage(createBlankBaseLayer(256))
    useCompositionStore.temporal.getState().clear()
    useCompositionStore.getState().setBaseBackground(null)
    expect(useCompositionStore.temporal.getState().pastStates).toHaveLength(1)

    useCompositionStore.temporal.getState().undo()
    const base = useCompositionStore.getState().layers.find((l) => l.isBaseImage)!
    expect(base.fullResBytesRef).toEqual({ kind: 'blank', fill: '#ffffff' })
  })
})
