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
    opacity: 1,
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
    opacity: 1,
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
    expect(state.selectedLayerIds).toEqual([base.id])
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

  it('selectLayer sets and clears the selection', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const base = useCompositionStore.getState().layers[0]

    store().selectLayer(null)
    expect(useCompositionStore.getState().selectedLayerIds).toEqual([])

    store().selectLayer(base.id)
    expect(useCompositionStore.getState().selectedLayerIds).toEqual([base.id])
  })

  it('selectLayer replace keeps an existing selection when clicking a member', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const o1 = makeOverlayLayer('o1.png', 0, 0)
    const o2 = makeOverlayLayer('o2.png', 24, 24)
    store().addOverlay(o1)
    store().addOverlay(o2)
    // addOverlay selects each new overlay, so start from a clean slate before
    // building a known multi-selection.
    store().selectLayer(null)
    store().selectLayer(o1.id, 'toggle')
    store().selectLayer(o2.id, 'toggle')
    expect(useCompositionStore.getState().selectedLayerIds).toEqual([
      o1.id,
      o2.id,
    ])

    // Plain (replace) click on o1 — already selected — keeps the group.
    store().selectLayer(o1.id, 'replace')
    expect(useCompositionStore.getState().selectedLayerIds).toEqual([
      o1.id,
      o2.id,
    ])
  })

  it('selectLayer toggle adds and removes; add is idempotent', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const o1 = makeOverlayLayer('o1.png', 0, 0)
    const o2 = makeOverlayLayer('o2.png', 24, 24)
    store().addOverlay(o1)
    store().addOverlay(o2)
    store().selectLayer(null)

    store().selectLayer(o1.id, 'toggle')
    store().selectLayer(o2.id, 'toggle')
    expect(useCompositionStore.getState().selectedLayerIds).toEqual([
      o1.id,
      o2.id,
    ])

    // toggle off
    store().selectLayer(o1.id, 'toggle')
    expect(useCompositionStore.getState().selectedLayerIds).toEqual([o2.id])

    // add is idempotent
    store().selectLayer(o2.id, 'add')
    expect(useCompositionStore.getState().selectedLayerIds).toEqual([o2.id])
    store().selectLayer(o1.id, 'add')
    expect(useCompositionStore.getState().selectedLayerIds).toEqual([
      o2.id,
      o1.id,
    ])
  })

  it('updateLayersTransform moves multiple layers in one update (group drag)', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const o1 = makeOverlayLayer('o1.png', 10, 10)
    const o2 = makeOverlayLayer('o2.png', 50, 50)
    store().addOverlay(o1)
    store().addOverlay(o2)
    useCompositionStore.setState({ isDirty: false })

    store().updateLayersTransform([
      { id: o1.id, patch: { x: 12.3, y: 7.6 } },
      { id: o2.id, patch: { x: 52.1, y: 49.4 } },
    ])

    const layers = useCompositionStore.getState().layers
    const a = layers.find((l) => l.id === o1.id)
    const b = layers.find((l) => l.id === o2.id)
    // Both moved, both snapped to the half-pixel grid, isDirty flipped.
    expect(a?.x).toBe(12.5)
    expect(a?.y).toBe(7.5)
    expect(b?.x).toBe(52)
    expect(b?.y).toBe(49.5)
    expect(useCompositionStore.getState().isDirty).toBe(true)
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

  it('updateLayerOpacity sets the value and marks dirty', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    useCompositionStore.setState({ isDirty: false })
    const base = useCompositionStore.getState().layers[0]

    store().updateLayerOpacity(base.id, 0.5)

    const updated = useCompositionStore
      .getState()
      .layers.find((l) => l.id === base.id)
    expect(updated?.opacity).toBe(0.5)
    expect(useCompositionStore.getState().isDirty).toBe(true)
  })

  it('updateLayerOpacity clamps out-of-range values to [0, 1]', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const base = useCompositionStore.getState().layers[0]

    store().updateLayerOpacity(base.id, 5)
    expect(
      useCompositionStore.getState().layers.find((l) => l.id === base.id)
        ?.opacity,
    ).toBe(1)

    store().updateLayerOpacity(base.id, -2)
    expect(
      useCompositionStore.getState().layers.find((l) => l.id === base.id)
        ?.opacity,
    ).toBe(0)
  })

  it('deleteLayer removes the layer, clears a matching selection, and sets dirty', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png', 0, 0))
    const overlay = useCompositionStore
      .getState()
      .layers.find((l) => !l.isBaseImage)

    // addOverlay selects the new overlay.
    expect(useCompositionStore.getState().selectedLayerIds).toEqual([
      overlay?.id,
    ])

    store().deleteLayer(overlay!.id)
    const state = useCompositionStore.getState()

    expect(state.layers.find((l) => l.id === overlay!.id)).toBeUndefined()
    expect(state.selectedLayerIds).toEqual([])
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
    expect(useCompositionStore.getState().selectedLayerIds).toEqual([o2.id])
  })

  it('resetComposition clears canvas, layers, selection and isDirty', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png', 0, 0))
    store().resetComposition()

    const state = useCompositionStore.getState()
    expect(state.canvas).toBeNull()
    expect(state.layers).toEqual([])
    expect(state.selectedLayerIds).toEqual([])
    expect(state.isDirty).toBe(false)
  })

  it('markClean clears isDirty without touching the composition', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png', 0, 0))
    expect(useCompositionStore.getState().isDirty).toBe(true)

    useCompositionStore.getState().markClean()
    const state = useCompositionStore.getState()
    expect(state.isDirty).toBe(false)
    // The composition itself is untouched — only the dirty flag moved.
    expect(state.layers).toHaveLength(2)
    expect(state.canvas).toEqual({ width: 800, height: 600 })
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

describe('resetLayersAspect (revert to natural aspect ratio)', () => {
  /** Build an overlay with full control over natural + rendered dims. */
  function makeOverlayWithDims(
    naturalWidth: number,
    naturalHeight: number,
    width: number,
    height: number,
    x = 0,
    y = 0,
  ): Layer {
    const id = createLayerId()
    return {
      id,
      originalFilename: 'o.png',
      mimeType: 'image/png',
      previewUrl: `blob:o-${id}`,
      fullResBytesRef: { kind: 'file', file: new File([], 'o.png') },
      x,
      y,
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

  beforeEach(() => {
    useCompositionStore.getState().resetComposition()
  })

  it('restores a distorted layer to its natural ratio holding width, recentered vertically', () => {
    // Natural 4:3, distorted to 200x60 (way too short for a 4:3 at width 200).
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayWithDims(400, 300, 200, 60, 10, 20)
    store().addOverlay(overlay)

    store().resetLayersAspect([overlay.id])

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    // Width held.
    expect(result.width).toBe(200)
    // Height derived: 200 / (400/300) = 150.
    expect(result.height).toBe(150)
    // Vertical center preserved: y + (oldH - newH)/2 = 20 + (60 - 150)/2 = -25.
    expect(result.y).toBe(-25)
    // x untouched (we hold width, recenter on y only).
    expect(result.x).toBe(10)
    expect(useCompositionStore.getState().isDirty).toBe(true)
  })

  it('is a near-no-op when the layer already matches its natural ratio', () => {
    // Natural 4:3, rendered 4:3 (200x150) — already correct.
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayWithDims(400, 300, 200, 150, 7, 9)
    store().addOverlay(overlay)

    store().resetLayersAspect([overlay.id])

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    expect(result.width).toBe(200)
    expect(result.height).toBe(150)
    expect(result.x).toBe(7)
    expect(result.y).toBe(9) // (150-150)/2 = 0 delta
  })

  it('snaps the derived height and y to the half-pixel grid', () => {
    // Pick dims whose derived height is NOT already on the half-pixel grid.
    // naturalRatio = 300/200 = 1.5; height = 100 / 1.5 = 66.666…
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayWithDims(300, 200, 100, 40, 0, 0)
    store().addOverlay(overlay)

    store().resetLayersAspect([overlay.id])

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    // Derived height 66.666… and y -13.333… both land on the half-pixel grid.
    expect(result.height).toBe(66.5)
    expect(result.y).toBe(-13.5)
    // Snapping to the grid introduces a tiny ratio drift (100/66.5 = 1.5038),
    // which is expected — the grid is authoritative. Assert it stays within a
    // quarter-pixel of the true ratio rather than exact.
    const ratio = result.width / result.height
    expect(Math.abs(ratio - 1.5)).toBeLessThan(0.01)
  })

  it('reverts each layer independently in a multi-select (distinct ratios)', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const a = makeOverlayWithDims(400, 300, 200, 60, 0, 0) // 4:3, squished
    const b = makeOverlayWithDims(100, 100, 100, 50, 0, 0) // 1:1, squished
    store().addOverlay(a)
    store().addOverlay(b)

    store().resetLayersAspect([a.id, b.id])

    const layers = useCompositionStore.getState().layers
    const ra = layers.find((l) => l.id === a.id)!
    const rb = layers.find((l) => l.id === b.id)!
    expect(ra.height).toBe(150) // 200 / (4/3)
    expect(rb.height).toBe(100) // 100 / 1
    expect(ra.width).toBe(200)
    expect(rb.width).toBe(100)
  })

  it('ignores ids that do not resolve to a layer', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayWithDims(400, 300, 200, 60)
    store().addOverlay(overlay)
    useCompositionStore.setState({ isDirty: false })

    store().resetLayersAspect(['nope-not-a-layer', overlay.id])

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    expect(result.height).toBe(150)
  })

  it('skips layers with zero natural dimensions (guard against div-by-zero)', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const zero = makeOverlayWithDims(0, 0, 200, 60)
    store().addOverlay(zero)
    useCompositionStore.setState({ isDirty: false })

    expect(() => store().resetLayersAspect([zero.id])).not.toThrow()
    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === zero.id,
    )!
    // Untouched.
    expect(result.width).toBe(200)
    expect(result.height).toBe(60)
    expect(useCompositionStore.getState().isDirty).toBe(false)
  })

  it('is idempotent: calling twice yields the same geometry', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayWithDims(400, 300, 200, 60, 10, 20)
    store().addOverlay(overlay)

    store().resetLayersAspect([overlay.id])
    const after1 = { ...useCompositionStore.getState().layers.find((l) => l.id === overlay.id)! }
    store().resetLayersAspect([overlay.id])
    const after2 = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!

    expect(after2.width).toBe(after1.width)
    expect(after2.height).toBe(after1.height)
    expect(after2.x).toBe(after1.x)
    expect(after2.y).toBe(after1.y)
  })
})
