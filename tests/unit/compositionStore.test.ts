import { describe, it, expect, beforeEach } from 'vitest'
import { useCompositionStore } from '../../src/state/compositionStore'
import type { Layer } from '../../src/types/layer'
import { createLayerId } from '../../src/types/layer'

/**
 * Store unit tests. The zustand store is a singleton, so we reset it between
 * tests via `resetComposition()`. Browser decode (Image/object URL) is not
 * exercised here — these tests cover the PURE state transitions by constructing
 * Layer objects directly and passing them to the actions.
 */

function makeBaseLayer(
  naturalWidth: number,
  naturalHeight: number,
  id: string = createLayerId(),
): Layer {
  return {
    id,
    originalFilename: 'base.png',
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
    zIndex: 0,
    visible: true,
    locked: false,
    isBaseImage: true,
  }
}

function makeOverlayLayer(
  name: string,
  x: number,
  y: number,
  id: string = createLayerId(),
): Layer {
  return {
    id,
    originalFilename: name,
    mimeType: 'image/png',
    previewUrl: `blob:overlay-${id}`,
    fullResBytesRef: { kind: 'file', file: new File([], name) },
    x,
    y,
    width: 100,
    height: 100,
    naturalWidth: 100,
    naturalHeight: 100,
    rotation: 0,
    zIndex: 0,
    visible: true,
    locked: false,
    isBaseImage: false,
  }
}

const store = () => useCompositionStore.getState()

beforeEach(() => {
  useCompositionStore.getState().resetComposition()
})

describe('compositionStore', () => {
  it('setBaseImage sets canvas to natural size with a base at (0,0) z-index 0', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const state = useCompositionStore.getState()

    expect(state.canvas).toEqual({ width: 800, height: 600 })
    expect(state.layers).toHaveLength(1)

    const base = state.layers[0]
    expect(base.isBaseImage).toBe(true)
    expect(base.zIndex).toBe(0)
    expect(base.x).toBe(0)
    expect(base.y).toBe(0)
    expect(base.width).toBe(800)
    expect(base.height).toBe(600)
    expect(state.selectedLayerId).toBe(base.id)
    expect(state.isDirty).toBe(true)
  })

  it('replacing the base changes canvas size and leaves exactly one base layer', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png', 10, 10))
    store().setBaseImage(makeBaseLayer(400, 300))
    const state = useCompositionStore.getState()

    expect(state.canvas).toEqual({ width: 400, height: 300 })
    expect(state.layers.filter((l) => l.isBaseImage)).toHaveLength(1)
    // Existing overlays survive the base replacement.
    expect(state.layers.filter((l) => !l.isBaseImage)).toHaveLength(1)
    expect(state.layers[0].isBaseImage).toBe(true)
  })

  it('adding multiple overlays assigns strictly increasing z-indices > 0, after the base', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png', 0, 0))
    store().addOverlay(makeOverlayLayer('o2.png', 24, 24))
    store().addOverlay(makeOverlayLayer('o3.png', 48, 48))
    const state = useCompositionStore.getState()

    const overlays = state.layers.filter((l) => !l.isBaseImage)
    expect(overlays).toHaveLength(3)

    const zIndices = overlays.map((l) => l.zIndex)
    zIndices.forEach((z) => expect(z).toBeGreaterThan(0))
    expect(zIndices).toEqual([1, 2, 3])

    // Base leads the array so overlays appear after it.
    expect(state.layers[0].isBaseImage).toBe(true)
  })

  it('selectLayer sets and clears selectedLayerId', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const base = useCompositionStore.getState().layers[0]

    store().selectLayer(null)
    expect(useCompositionStore.getState().selectedLayerId).toBeNull()

    store().selectLayer(base.id)
    expect(useCompositionStore.getState().selectedLayerId).toBe(base.id)
  })

  it('updateLayerTransform merges the patch and leaves other fields untouched', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    useCompositionStore.setState({ isDirty: false })
    const base = useCompositionStore.getState().layers[0]

    store().updateLayerTransform(base.id, { x: 50, width: 700 })

    const updated = useCompositionStore.getState().layers.find(
      (l) => l.id === base.id,
    )
    expect(updated?.x).toBe(50)
    expect(updated?.width).toBe(700)
    expect(updated?.y).toBe(0)
    expect(updated?.height).toBe(600)
    expect(useCompositionStore.getState().isDirty).toBe(true)
  })

  it('deleteLayer removes the layer, clears a matching selection, and sets dirty', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png', 0, 0))
    const overlay = useCompositionStore
      .getState()
      .layers.find((l) => !l.isBaseImage)

    // addOverlay selects the new overlay.
    expect(useCompositionStore.getState().selectedLayerId).toBe(overlay?.id)

    store().deleteLayer(overlay!.id)
    const state = useCompositionStore.getState()

    expect(state.layers.find((l) => l.id === overlay!.id)).toBeUndefined()
    expect(state.selectedLayerId).toBeNull()
    expect(state.isDirty).toBe(true)
  })

  it('deleteLayer leaves selection intact when deleting a non-selected layer', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png', 0, 0))
    store().addOverlay(makeOverlayLayer('o2.png', 24, 24))
    const [o1, o2] = useCompositionStore
      .getState()
      .layers.filter((l) => !l.isBaseImage)
    // o2 is selected (most recent addOverlay).
    store().deleteLayer(o1.id)
    expect(useCompositionStore.getState().selectedLayerId).toBe(o2.id)
  })

  it('resetComposition clears canvas, layers, selection and isDirty', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png', 0, 0))
    store().resetComposition()

    const state = useCompositionStore.getState()
    expect(state.canvas).toBeNull()
    expect(state.layers).toEqual([])
    expect(state.selectedLayerId).toBeNull()
    expect(state.isDirty).toBe(false)
  })

  it('addOverlay determinism: two overlays get distinct ids and positions', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('a.png', 5, 5))
    store().addOverlay(makeOverlayLayer('b.png', 30, 30))

    const overlays = useCompositionStore
      .getState()
      .layers.filter((l) => !l.isBaseImage)
    expect(overlays[0].id).not.toBe(overlays[1].id)
    expect(overlays[0].x).not.toBe(overlays[1].x)
    expect(overlays[0].y).not.toBe(overlays[1].y)
  })

  it('reorderLayer moves within the array and renumbers densely with base at 0', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png', 0, 0))
    store().addOverlay(makeOverlayLayer('o2.png', 24, 24))
    store().addOverlay(makeOverlayLayer('o3.png', 48, 48))
    // Array before: [base(0), o1(1), o2(2), o3(3)]. Move o3 (idx 3) to idx 1.
    store().reorderLayer(3, 1)

    const state = useCompositionStore.getState()
    const base = state.layers.find((l) => l.isBaseImage)
    expect(base?.zIndex).toBe(0)

    const overlayZ = state.layers
      .filter((l) => !l.isBaseImage)
      .map((l) => l.zIndex)
      .sort((a, b) => a - b)
    expect(overlayZ).toEqual([1, 2, 3])
    expect(state.isDirty).toBe(true)
  })
})
