/**
 * Undo/redo history tests (zundo `temporal` middleware).
 *
 * These cover the behaviors the plan (§A) requires:
 *   - discrete mutations each record one undo step, and undo/redo round-trip;
 *   - selection (selectedLayerIds) is NOT tracked — undo leaves it intact;
 *   - isDirty is NOT tracked (D1 = option a) — undo never flips the dot;
 *   - the commit-only gesture coalescing (beginGesture/commitGesture) collapses
 *     a burst of writes to a single undo step, and a no-op gesture records
 *     nothing;
 *   - history is capped at HISTORY_LIMIT;
 *   - resetComposition clears history (it's a one-way trip).
 *
 * The store is a module singleton, so we reset it (and its history) between
 * tests. `beginGesture`/`commitGesture` are imported directly to drive a gesture
 * without React/DOM machinery.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useCompositionStore, HISTORY_LIMIT } from '../../src/state/compositionStore'
import {
  beginGesture,
  commitGesture,
  undo,
  redo,
} from '../../src/state/useTemporalStore'
import type { Layer } from '../../src/types/layer'
import { createLayerId } from '../../src/types/layer'

function makeBaseLayer(naturalWidth: number, naturalHeight: number): Layer {
  const id = createLayerId()
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

function makeOverlayLayer(name: string): Layer {
  const id = createLayerId()
  return {
    id,
    originalFilename: name,
    name: null,
    mimeType: 'image/png',
    previewUrl: `blob:overlay-${id}`,
    fullResBytesRef: { kind: 'file', file: new File([], name) },
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

const store = () => useCompositionStore.getState()
const temporal = () => useCompositionStore.temporal.getState()

beforeEach(() => {
  // resetComposition also calls temporal.clear(), so we start each test with a
  // blank store AND blank history.
  useCompositionStore.getState().resetComposition()
})

describe('history — discrete actions', () => {
  it('records one past state per discrete mutation', () => {
    store().setBaseImage(makeBaseLayer(800, 600)) // 1
    store().addOverlay(makeOverlayLayer('o1.png')) // 2
    store().addOverlay(makeOverlayLayer('o2.png')) // 3

    expect(temporal().pastStates).toHaveLength(3)
    expect(temporal().futureStates).toHaveLength(0)
    expect(store().layers).toHaveLength(3)
  })

  it('undo reverts the last discrete step; redo re-applies it', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png'))
    expect(store().layers).toHaveLength(2)

    temporal().undo()
    expect(store().layers).toHaveLength(1) // overlay removed
    expect(temporal().futureStates).toHaveLength(1)

    temporal().redo()
    expect(store().layers).toHaveLength(2) // overlay restored
    expect(temporal().futureStates).toHaveLength(0)
  })

  it('undo of a deleteLayer revives the deleted layer', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayLayer('o1.png')
    store().addOverlay(overlay)
    const overlayId = overlay.id

    store().deleteLayer(overlayId)
    expect(store().layers.find((l) => l.id === overlayId)).toBeUndefined()

    temporal().undo()
    const revived = store().layers.find((l) => l.id === overlayId)
    expect(revived).toBeDefined()
    // The revived layer keeps its (non-revoked) preview URL so it still renders.
    expect(revived?.previewUrl).toBe(overlay.previewUrl)
  })

  it('undo of updateLayerOpacity restores the prior opacity', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const base = store().layers[0]
    store().updateLayerOpacity(base.id, 0.25)
    store().updateLayerOpacity(base.id, 0.75)

    temporal().undo()
    expect(
      store().layers.find((l) => l.id === base.id)?.opacity,
    ).toBe(0.25)
    temporal().undo()
    expect(
      store().layers.find((l) => l.id === base.id)?.opacity,
    ).toBe(1)
  })

  it('undo of resetLayersAspect undoes the aspect restore', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    // Distort a 4:3 layer down to 200x60.
    const id = createLayerId()
    const distorted: Layer = {
      ...makeOverlayLayer('o.png'),
      id,
      naturalWidth: 400,
      naturalHeight: 300,
      width: 200,
      height: 60,
    }
    store().addOverlay(distorted)
    store().resetLayersAspect([id])
    expect(
      store().layers.find((l) => l.id === id)?.height,
    ).toBe(150) // restored

    temporal().undo()
    expect(
      store().layers.find((l) => l.id === id)?.height,
    ).toBe(60) // back to distorted
  })

  it('undo of resetLayersToOriginalSize undoes the size restore', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    // Scale a 100x100 layer up to 200x200.
    const id = createLayerId()
    const resized: Layer = {
      ...makeOverlayLayer('o.png'),
      id,
      naturalWidth: 100,
      naturalHeight: 100,
      width: 200,
      height: 200,
    }
    store().addOverlay(resized)
    store().resetLayersToOriginalSize([id])
    expect(
      store().layers.find((l) => l.id === id)?.width,
    ).toBe(100) // restored

    temporal().undo()
    expect(
      store().layers.find((l) => l.id === id)?.width,
    ).toBe(200) // back to resized
  })
})

describe('history — selection is NOT tracked', () => {
  it('changing only the selection records no history entry', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png'))
    store().addOverlay(makeOverlayLayer('o2.png'))
    const before = temporal().pastStates.length

    // Pure selection mutations.
    store().selectLayer(null)
    store().selectLayer(store().layers[1].id, 'replace')
    store().clearSelection()

    expect(temporal().pastStates.length).toBe(before) // unchanged
  })

  it('undo leaves the current selection intact', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const o1 = makeOverlayLayer('o1.png')
    store().addOverlay(o1)
    // Select the overlay, then mutate geometry.
    store().selectLayer(o1.id)
    store().updateLayerTransform(o1.id, { x: 99 })

    temporal().undo()
    // Geometry reverted…
    expect(store().layers.find((l) => l.id === o1.id)?.x).toBe(10)
    // …but the selection survived.
    expect(store().selectedLayerIds).toContain(o1.id)
  })
})

describe('history — isDirty is NOT tracked (D1 = option a)', () => {
  it('undo does not flip the dirty flag back to false', () => {
    store().setBaseImage(makeBaseLayer(800, 600)) // isDirty -> true
    store().addOverlay(makeOverlayLayer('o1.png'))
    expect(store().isDirty).toBe(true)

    temporal().undo() // remove overlay
    temporal().undo() // remove overlay's add
    temporal().undo() // back to before setBaseImage
    // Even fully undone, isDirty stays sticky-true (only Export/Reset clear it).
    expect(store().isDirty).toBe(true)
  })

  it('markClean is not itself an undoable step', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const beforeClear = temporal().pastStates.length
    store().markClean()
    // markClean only sets isDirty, which isn't tracked → no history entry.
    expect(temporal().pastStates.length).toBe(beforeClear)
  })
})

describe('history — gesture coalescing (commit-only pattern)', () => {
  it('collapses a burst of writes between begin/commit into ONE undo step', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayLayer('o1.png')
    store().addOverlay(overlay)
    const preGestureHistory = temporal().pastStates.length

    // Simulate a drag: snapshot + pause, several moves, commit on pointer-up.
    const snap = beginGesture()
    store().updateLayerTransform(overlay.id, { x: 20 })
    store().updateLayerTransform(overlay.id, { x: 30 })
    store().updateLayerTransform(overlay.id, { x: 40 })
    store().updateLayerTransform(overlay.id, { x: 50 })
    commitGesture(snap)

    // Exactly ONE new history entry, regardless of the four writes.
    expect(temporal().pastStates.length).toBe(preGestureHistory + 1)
    // And the live state reflects the final move.
    expect(store().layers.find((l) => l.id === overlay.id)?.x).toBe(50)

    // A single undo reverts the whole drag in one step.
    temporal().undo()
    expect(store().layers.find((l) => l.id === overlay.id)?.x).toBe(10) // pre-gesture x
    expect(temporal().pastStates.length).toBe(preGestureHistory)
  })

  it('a no-op gesture (begin with no move) records nothing', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const before = temporal().pastStates.length

    const snap = beginGesture()
    // …no moves…
    commitGesture(snap)

    expect(temporal().pastStates.length).toBe(before)
    expect(temporal().futureStates).toHaveLength(0)
  })

  it('a coalesced gesture clears the redo stack (new branch)', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayLayer('o1.png')
    store().addOverlay(overlay)
    temporal().undo() // creates a future entry
    expect(temporal().futureStates.length).toBe(1)

    // A new gesture should branch, discarding the redo future.
    const snap = beginGesture()
    store().updateLayerTransform(overlay.id, { x: 77 })
    commitGesture(snap)

    expect(temporal().futureStates).toHaveLength(0)
  })

  it('undo()/redo() helpers from useTemporalStore module drive history', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png'))
    expect(store().layers).toHaveLength(2)

    undo()
    expect(store().layers).toHaveLength(1)
    redo()
    expect(store().layers).toHaveLength(2)
  })
})

describe('history — re-entrant (nested) gestures', () => {
  // Text editing + canvas drags can overlap: a canvas pointerdown fires before
  // a focused textarea's blur, so gestures nest. The depth-counted pause/resume
  // must collapse the whole stack to ONE undo step and never resume tracking on
  // an inner commit.

  it('nested begin/commit yields exactly ONE entry, not two', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayLayer('o1.png')
    store().addOverlay(overlay)
    const pre = temporal().pastStates.length

    // Outer gesture begins; then an inner gesture begins and commits inside it.
    const snapA = beginGesture()
    store().updateLayerTransform(overlay.id, { x: 20 })
    const snapB = beginGesture()
    store().updateLayerTransform(overlay.id, { x: 30 })
    commitGesture(snapB) // inner commit — must NOT resume or push
    store().updateLayerTransform(overlay.id, { x: 40 })
    commitGesture(snapA) // outer commit — resumes + pushes the pre-gesture state

    expect(temporal().pastStates.length).toBe(pre + 1) // exactly one entry
    // The live state reflects the final move.
    expect(store().layers.find((l) => l.id === overlay.id)?.x).toBe(40)
    // A single undo reverts the whole nested stack in one step.
    temporal().undo()
    expect(store().layers.find((l) => l.id === overlay.id)?.x).toBe(10)
    expect(temporal().pastStates.length).toBe(pre)
  })

  it('an inner commit does NOT resume tracking', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayLayer('o1.png')
    store().addOverlay(overlay)

    const snapA = beginGesture()
    const snapB = beginGesture()
    commitGesture(snapB) // inner commit — depth still 1, tracking must stay paused

    // If tracking had resumed here, this write would record its own entry.
    const before = temporal().pastStates.length
    store().updateLayerTransform(overlay.id, { x: 50 })
    expect(temporal().pastStates.length).toBe(before) // still paused → no entry

    commitGesture(snapA) // outer commit finally resumes + pushes
    expect(temporal().pastStates.length).toBe(before + 1)
  })

  it('a nested no-op records nothing', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const overlay = makeOverlayLayer('o1.png')
    store().addOverlay(overlay)
    const pre = temporal().pastStates.length

    const snapA = beginGesture()
    const snapB = beginGesture()
    // …no moves…
    commitGesture(snapB) // inner no-op
    commitGesture(snapA) // outer no-op — no net change → nothing pushed

    expect(temporal().pastStates.length).toBe(pre)
    expect(temporal().futureStates).toHaveLength(0)
  })
})

describe('history — limit & reset', () => {
  it('caps past states at HISTORY_LIMIT', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const base = store().layers[0]
    // Generate well over the limit of discrete opacity writes.
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      store().updateLayerOpacity(base.id, (i % 100) / 100)
    }
    expect(temporal().pastStates.length).toBeLessThanOrEqual(HISTORY_LIMIT)
    // Oldest entries fell off the front.
    expect(temporal().pastStates.length).toBe(HISTORY_LIMIT)
  })

  it('resetComposition wipes both past and future', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    store().addOverlay(makeOverlayLayer('o1.png'))
    temporal().undo()
    expect(temporal().pastStates.length).toBeGreaterThan(0)
    expect(temporal().futureStates.length).toBeGreaterThan(0)

    store().resetComposition()

    expect(temporal().pastStates).toHaveLength(0)
    expect(temporal().futureStates).toHaveLength(0)
    expect(store().layers).toHaveLength(0)
  })
})

describe('history — setLayersBorder', () => {
  function layer(id: string) {
    return useCompositionStore.getState().layers.find((l) => l.id === id)!
  }

  it('one setLayersBorder on 3 layers records a single past state; undo reverts all', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const a = makeOverlayLayer('a.png')
    const b = makeOverlayLayer('b.png')
    const c = makeOverlayLayer('c.png')
    store().addOverlay(a)
    store().addOverlay(b)
    store().addOverlay(c)
    useCompositionStore.temporal.getState().clear()

    store().setLayersBorder([a.id, b.id, c.id], {
      color: '#cccccc',
      width: 1,
      padding: 0,
    })
    expect(temporal().pastStates).toHaveLength(1)

    undo()
    expect(layer(a.id).border).toBeUndefined()
    expect(layer(b.id).border).toBeUndefined()
    expect(layer(c.id).border).toBeUndefined()
  })

  it('a no-op call (matching nothing) records no history entry', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    useCompositionStore.temporal.getState().clear()
    store().setLayersBorder([], { color: '#cccccc', width: 1, padding: 0 })
    expect(temporal().pastStates).toHaveLength(0)
  })

  it('add -> width -> padding walks back one step at a time', () => {
    store().setBaseImage(makeBaseLayer(800, 600))
    const a = makeOverlayLayer('a.png')
    store().addOverlay(a)
    useCompositionStore.temporal.getState().clear()

    store().setLayersBorder([a.id], { color: '#cccccc', width: 1, padding: 0 })
    store().setLayersBorder([a.id], { color: '#cccccc', width: 4, padding: 0 })
    store().setLayersBorder([a.id], { color: '#cccccc', width: 4, padding: 6 })
    expect(temporal().pastStates).toHaveLength(3)

    undo() // back to width=4, padding=0
    expect(layer(a.id).border).toEqual({ color: '#cccccc', width: 4, padding: 0 })
    undo() // back to width=1, padding=0
    expect(layer(a.id).border).toEqual({ color: '#cccccc', width: 1, padding: 0 })
    undo() // back to no border
    expect(layer(a.id).border).toBeUndefined()
  })
})
