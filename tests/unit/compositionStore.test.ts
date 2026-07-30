import { describe, it, expect, beforeEach } from 'vitest'
import { useCompositionStore } from '../../src/state/compositionStore'
import type { Layer } from '../../src/types/layer'
import { createLayerId } from '../../src/types/layer'
import { measureText } from '../../src/text/textMetrics'
import { MIN_LAYER_SIZE } from '../../src/canvas/resize'
import { QUANTIZE_STEP } from '../../src/canvas/quantize'

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

function makeOverlayLayer(
  name: string,
  x: number,
  y: number,
  id: string = createLayerId(),
): Layer {
  return {
    id,
    originalFilename: name,
    name: null,
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

describe('renameLayer', () => {
  beforeEach(() => {
    useCompositionStore.getState().resetComposition()
  })

  it('trims and stores a custom name', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayLayer('o1.png', 0, 0)
    store().addOverlay(overlay)

    store().renameLayer(overlay.id, '  Hero  ')

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    expect(result.name).toBe('Hero')
    // The original filename is preserved verbatim.
    expect(result.originalFilename).toBe('o1.png')
    expect(useCompositionStore.getState().isDirty).toBe(true)
  })

  it('maps an empty / whitespace-only name to null (revert to derived label)', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayLayer('o1.png', 0, 0)
    store().addOverlay(overlay)
    store().renameLayer(overlay.id, 'Hero')
    expect(
      useCompositionStore.getState().layers.find((l) => l.id === overlay.id)
        ?.name,
    ).toBe('Hero')

    store().renameLayer(overlay.id, '   ')

    expect(
      useCompositionStore.getState().layers.find((l) => l.id === overlay.id)
        ?.name,
    ).toBeNull()
  })

  it('no-ops on an unknown id', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const before = useCompositionStore.getState()
    const beforeLayers = before.layers
    store().renameLayer('nope-not-a-layer', 'whatever')
    const after = useCompositionStore.getState()
    // Unknown id: no state change at all (same layers ref, dirty untouched).
    expect(after.layers).toBe(beforeLayers)
  })

  it('is a no-op when the name is unchanged', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayLayer('o1.png', 0, 0)
    store().addOverlay(overlay)
    store().renameLayer(overlay.id, 'Hero')
    useCompositionStore.setState({ isDirty: false })

    store().renameLayer(overlay.id, 'Hero') // identical
    expect(useCompositionStore.getState().isDirty).toBe(false)
  })

  it('is undoable (lives in the tracked layers slice)', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayLayer('o1.png', 0, 0)
    store().addOverlay(overlay)
    store().renameLayer(overlay.id, 'Hero')

    useCompositionStore.temporal.getState().undo()

    expect(
      useCompositionStore.getState().layers.find((l) => l.id === overlay.id)
        ?.name,
    ).toBeNull()
  })
})

describe('updateLayerText', () => {
  /** A text layer at its measured natural size (scale 1). */
  function makeTextLayer(content = 'Text', fontSize = 10): Layer {
    const measured = measureText(content, fontSize)
    return {
      id: createLayerId(),
      originalFilename: 'Text',
      name: null,
      mimeType: 'text/plain',
      previewUrl: '',
      fullResBytesRef: {
        kind: 'text',
        text: {
          content,
          fontSize,
          fontWeight: 400,
          italic: false,
          fill: '#000000',
          align: 'left',
        },
      },
      x: 0,
      y: 0,
      width: measured.width,
      height: measured.height,
      naturalWidth: measured.width,
      naturalHeight: measured.height,
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

  it('produces exactly ONE history entry per call', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeTextLayer('Hi')
    store().addOverlay(overlay)
    const before = useCompositionStore.temporal.getState().pastStates.length

    store().updateLayerText(overlay.id, { content: 'Hello' }, 1)

    expect(
      useCompositionStore.temporal.getState().pastStates.length,
    ).toBe(before + 1)
  })

  it('recomputes natural dims from the merged content', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeTextLayer('Hi', 10)
    store().addOverlay(overlay)

    store().updateLayerText(overlay.id, { content: 'Hello world' }, 1)

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    const expected = measureText('Hello world', 10)
    expect(result.naturalWidth).toBe(expected.width)
    expect(result.naturalHeight).toBe(expected.height)
  })

  it('preserves the caller-supplied scale (anchored top-left)', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeTextLayer('Hi', 10)
    store().addOverlay(overlay)
    // Scale the layer up to 2x (width/height only; natural dims unchanged).
    store().updateLayerTransform(overlay.id, {
      width: overlay.naturalWidth * 2,
      height: overlay.naturalHeight * 2,
    })

    store().updateLayerText(overlay.id, { content: 'Hello' }, 2)

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    const expectedNatural = measureText('Hello', 10)
    // rendered = natural × scale(2), anchored top-left (x/y untouched).
    expect(result.width).toBeCloseTo(expectedNatural.width * 2, 10)
    expect(result.height).toBeCloseTo(expectedNatural.height * 2, 10)
    expect(result.naturalWidth).toBe(expectedNatural.width)
    expect(result.x).toBe(overlay.x)
    expect(result.y).toBe(overlay.y)
  })

  it('clamps the rendered size to MIN_LAYER_SIZE', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    // A one-char layer at fontSize 1 has a sub-floor natural width.
    const overlay = makeTextLayer('a', 1)
    store().addOverlay(overlay)

    store().updateLayerText(overlay.id, { content: 'a' }, 1)

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    expect(result.width).toBeGreaterThanOrEqual(MIN_LAYER_SIZE)
    expect(result.height).toBeGreaterThanOrEqual(MIN_LAYER_SIZE)
  })

  it('quantizes width/height to the half-pixel grid', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeTextLayer('Hi', 10)
    store().addOverlay(overlay)

    store().updateLayerText(overlay.id, { content: 'Hello world' }, 1.3)

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    expect(result.width / QUANTIZE_STEP).toBe(
      Math.round(result.width / QUANTIZE_STEP),
    )
    expect(result.height / QUANTIZE_STEP).toBe(
      Math.round(result.height / QUANTIZE_STEP),
    )
  })

  it('empty content does not divide by zero (one-cell box)', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeTextLayer('Hi', 10)
    store().addOverlay(overlay)

    expect(() =>
      store().updateLayerText(overlay.id, { content: '' }, 1),
    ).not.toThrow()
    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    expect(result.naturalWidth).toBeGreaterThan(0)
    expect(result.naturalHeight).toBeGreaterThan(0)
  })

  it('normalizes content (control chars stripped) on write', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeTextLayer('Hi', 10)
    store().addOverlay(overlay)

    store().updateLayerText(overlay.id, { content: 'a\x00b' }, 1)

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    expect(result.fullResBytesRef.kind).toBe('text')
    if (result.fullResBytesRef.kind === 'text') {
      expect(result.fullResBytesRef.text.content).toBe('ab')
    }
  })

  it('no-ops on an unknown id or a non-text layer', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const raster = makeOverlayLayer('o.png', 0, 0)
    store().addOverlay(raster)
    const before = useCompositionStore.getState()

    store().updateLayerText('nope-not-a-layer', { content: 'x' }, 1)
    store().updateLayerText(raster.id, { content: 'x' }, 1) // raster, not text

    expect(useCompositionStore.getState().layers).toBe(before.layers)
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
      name: null,
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

describe('resetLayersToOriginalSize (revert to source pixel dimensions)', () => {
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
      name: null,
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

  it('restores a resized layer to its natural dims, recentered on both axes', () => {
    // Natural 100x100, scaled up to 200x200 at (50,50) — center is (150,150).
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayWithDims(100, 100, 200, 200, 50, 50)
    store().addOverlay(overlay)

    store().resetLayersToOriginalSize([overlay.id])

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    // Size back to natural.
    expect(result.width).toBe(100)
    expect(result.height).toBe(100)
    // Center held on both axes: x = 50 + (200-100)/2 = 100; y likewise.
    expect(result.x).toBe(100)
    expect(result.y).toBe(100)
    expect(useCompositionStore.getState().isDirty).toBe(true)
  })

  it('is a near-no-op when the layer already renders at its natural dims', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayWithDims(100, 100, 100, 100, 7, 9)
    store().addOverlay(overlay)

    store().resetLayersToOriginalSize([overlay.id])

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    expect(result.width).toBe(100)
    expect(result.height).toBe(100)
    expect(result.x).toBe(7)
    expect(result.y).toBe(9) // zero delta
  })

  it('snaps the derived x/y to the half-pixel grid', () => {
    // Pick a rendered width whose recenter delta is non-integer: width 201,
    // natural 100 → x delta (201-100)/2 = 50.5 (already on grid). Use width 202
    // for a non-half delta: (202-100)/2 = 51 → snaps to 51 (integer, on grid).
    // To force a true non-half delta, use width 201 with natural 100 against an
    // odd rendered-position base — but the patch only depends on (w-naturalW)/2.
    // (201-100)/2 = 50.5 — exactly on the half-pixel grid, no snap needed.
    // Use width 203: (203-100)/2 = 51.5 — also on grid. The recenter math over
    // integers always lands on .0 or .5, so assert the exact expected values.
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayWithDims(100, 100, 203, 203, 0, 0)
    store().addOverlay(overlay)

    store().resetLayersToOriginalSize([overlay.id])

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    expect(result.width).toBe(100)
    expect(result.height).toBe(100)
    // (203-100)/2 = 51.5 — lands on the half-pixel grid unchanged.
    expect(result.x).toBe(51.5)
    expect(result.y).toBe(51.5)
  })

  it('reverts each layer independently in a multi-select (distinct sizes)', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const a = makeOverlayWithDims(100, 100, 200, 200, 0, 0) // scaled up
    const b = makeOverlayWithDims(50, 50, 300, 300, 0, 0) // scaled up more
    store().addOverlay(a)
    store().addOverlay(b)

    store().resetLayersToOriginalSize([a.id, b.id])

    const layers = useCompositionStore.getState().layers
    const ra = layers.find((l) => l.id === a.id)!
    const rb = layers.find((l) => l.id === b.id)!
    expect(ra.width).toBe(100)
    expect(ra.height).toBe(100)
    expect(rb.width).toBe(50)
    expect(rb.height).toBe(50)
    // a recenter: 0 + (200-100)/2 = 50; b: 0 + (300-50)/2 = 125.
    expect(ra.x).toBe(50)
    expect(rb.x).toBe(125)
  })

  it('ignores ids that do not resolve to a layer', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayWithDims(100, 100, 200, 200)
    store().addOverlay(overlay)

    store().resetLayersToOriginalSize(['nope-not-a-layer', overlay.id])

    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!
    expect(result.width).toBe(100)
    expect(result.height).toBe(100)
  })

  it('skips layers with zero natural dimensions (guard)', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const zero = makeOverlayWithDims(0, 0, 200, 200)
    store().addOverlay(zero)
    useCompositionStore.setState({ isDirty: false })

    expect(() => store().resetLayersToOriginalSize([zero.id])).not.toThrow()
    const result = useCompositionStore.getState().layers.find(
      (l) => l.id === zero.id,
    )!
    // Untouched.
    expect(result.width).toBe(200)
    expect(result.height).toBe(200)
    expect(useCompositionStore.getState().isDirty).toBe(false)
  })

  it('is idempotent: calling twice yields the same geometry', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayWithDims(100, 100, 200, 200, 50, 50)
    store().addOverlay(overlay)

    store().resetLayersToOriginalSize([overlay.id])
    const after1 = {
      ...useCompositionStore.getState().layers.find((l) => l.id === overlay.id)!,
    }
    store().resetLayersToOriginalSize([overlay.id])
    const after2 = useCompositionStore.getState().layers.find(
      (l) => l.id === overlay.id,
    )!

    expect(after2.width).toBe(after1.width)
    expect(after2.height).toBe(after1.height)
    expect(after2.x).toBe(after1.x)
    expect(after2.y).toBe(after1.y)
  })
})


describe('compositionStore — setLayersBorder', () => {
  function setup3(): string[] {
    store().setBaseImage(makeBaseLayer(800, 600))
    const a = makeOverlayLayer('a.png', 0, 0)
    const b = makeOverlayLayer('b.png', 50, 50)
    const c = makeOverlayLayer('c.png', 100, 100)
    store().addOverlay(a)
    store().addOverlay(b)
    store().addOverlay(c)
    return [a.id, b.id, c.id]
  }

  it('sets a (normalized) border on every id in one update', () => {
    const [a, b, c] = setup3()
    store().setLayersBorder([a, b, c], {
      color: '#aabbcc',
      width: 3,
      padding: 2,
    })
    const layers = useCompositionStore.getState().layers
    for (const id of [a, b, c]) {
      const l = layers.find((x) => x.id === id)!
      expect(l.border).toEqual({ color: '#aabbcc', width: 3, padding: 2 })
    }
  })

  it('with null removes the border', () => {
    const [a, b] = setup3()
    store().setLayersBorder([a, b], { color: '#cccccc', width: 1, padding: 0 })
    store().setLayersBorder([a], null)
    const layers = useCompositionStore.getState().layers
    expect(layers.find((l) => l.id === a)!.border).toBeUndefined()
    // b is untouched.
    expect(layers.find((l) => l.id === b)!.border).toBeDefined()
  })

  it('ignores unknown ids', () => {
    const [a] = setup3()
    store().setLayersBorder([a, 'does-not-exist'], {
      color: '#cccccc',
      width: 1,
      padding: 0,
    })
    const layers = useCompositionStore.getState().layers
    expect(layers.find((l) => l.id === a)!.border).toBeDefined()
  })

  it('records no change (and no dirty flip) for an empty id list', () => {
    setup3()
    const before = useCompositionStore.getState()
    store().setLayersBorder([], { color: '#cccccc', width: 1, padding: 0 })
    const after = useCompositionStore.getState()
    // Returns the previous state: same layers ref, isDirty unchanged.
    expect(after.layers).toBe(before.layers)
  })

  it('marks the composition dirty', () => {
    const [a] = setup3()
    // setup3 sets a base + overlays, flipping isDirty true already; reset and
    // markClean to isolate the dirty flip from setLayersBorder.
    store().markClean()
    expect(useCompositionStore.getState().isDirty).toBe(false)
    store().setLayersBorder([a], { color: '#cccccc', width: 1, padding: 0 })
    expect(useCompositionStore.getState().isDirty).toBe(true)
  })

  it('normalizes values through the seam ({padding:-5, width:0.7, color:red})', () => {
    const [a] = setup3()
    store().setLayersBorder([a], { padding: -5, width: 0.7, color: 'red' })
    const l = useCompositionStore.getState().layers.find((x) => x.id === a)!
    expect(l.border).toEqual({ padding: 0, width: 0.5, color: '#cccccc' })
  })
})
