import { create } from 'zustand'
import { temporal } from 'zundo'
import type { CompositionState, Layer } from '../types/layer'
import type { SelectionMode } from './selection'
import { quantizePatch } from '../canvas/quantize'

/**
 * Zustand composition store — the single source of truth every UI surface reads
 * from and writes through. Wrapped in zundo's `temporal` middleware so every
 * mutation funneled through `set()` is time-travelable: ⌘Z / ⌘⇧Z restore prior
 * composition states. Pointer gestures (drag/resize) are coalesced to a single
 * history entry each via `useTemporalStore` `pause`/`commitGesture` (see
 * `useCanvasPointer` + `ResizeHandle`).
 *
 * What history tracks: ONLY `{ canvas, layers }`. `selectedLayerIds` is excluded
 * (selection is interaction, not composition — undo must not yank your selection
 * around) and `isDirty` is excluded (decision D1 = option a: the save-status dot
 * is sticky-true once you edit; Export/Reset still clear it; undo never touches
 * it). Actions are excluded too — they're stable across sets and have no place
 * in a snapshot.
 *
 * Selectors should stay granular (e.g. `s => s.canvas`) so only the components
 * that actually depend on a slice re-render — important for the high-frequency
 * transform updates.
 */

/** Max snapshots kept in each of past/future. Object URLs (previewUrl) are
 *  shared by reference across snapshots, so even full-res sources stay cheap. */
export const HISTORY_LIMIT = 50

/**
 * The slice of state that history actually records. Narrowing here (rather than
 * omitting fields) keeps the type honest: a snapshot is just canvas + layers.
 */
export type TrackedComposition = Pick<CompositionState, 'canvas' | 'layers'>

/** A transform patch bound to the layer it applies to (used by the batch action). */
export interface LayerTransformUpdate {
  id: string
  patch: Partial<Pick<Layer, 'x' | 'y' | 'width' | 'height'>>
}

export interface CompositionStore extends CompositionState {
  /** Set/replace the base image. Canvas adopts the base's natural pixel size. */
  setBaseImage: (layer: Layer) => void
  /** Append an overlay; assigns the next dense z-index so it paints on top. */
  addOverlay: (layer: Layer) => void
  /** Mutate the selection. `id` null clears it; mode controls add/toggle/replace. */
  selectLayer: (id: string | null, mode?: SelectionMode) => void
  /** Clear the selection entirely. */
  clearSelection: () => void
  /** Merge a partial transform patch into a layer; the seam all transforms use.
   *  Values are snapped to the half-pixel grid (see `quantize`). */
  updateLayerTransform: (
    id: string,
    patch: Partial<Pick<Layer, 'x' | 'y' | 'width' | 'height'>>,
  ) => void
  /** Apply transform patches to many layers in one update (group drag, alignment).
   *  Every patch is snapped to the half-pixel grid. */
  updateLayersTransform: (updates: LayerTransformUpdate[]) => void
  /** Set a layer's opacity, clamped to [0, 1]. */
  updateLayerOpacity: (id: string, opacity: number) => void
  /** Revert one or more layers to their source aspect ratio, holding each
   *  layer's current width and re-anchoring so the center stays put (D2: keep
   *  width + center anchor). Routed through the shared transform seam, so each
   *  patch is snapped to the half-pixel grid and registers as one undo step
   *  once history lands. Layers with no natural dims are skipped. */
  resetLayersAspect: (ids: string[]) => void
  /** Revert one or more layers to their source pixel dimensions
   *  (`naturalWidth` × `naturalHeight`), re-anchoring on BOTH axes so each
   *  layer's center stays put (parallel to reset-aspect's vertical recenter).
   *  Routed through the shared transform seam: one undo step, half-pixel snap.
   *  Layers with no natural dims are skipped. */
  resetLayersToOriginalSize: (ids: string[]) => void
  /** Remove a layer; drops it from the selection if present. */
  deleteLayer: (id: string) => void
  /** Move a layer within the array and renumber z-indices densely (base stays 0). */
  reorderLayer: (fromIndex: number, toIndex: number) => void
  /** Clear the whole composition back to its initial empty state. */
  resetComposition: () => void
  /** Flip `isDirty` back to false without touching the composition — called
   *  after a successful Export so the save-status indicator can settle. This is
   *  the "save" loop until real persistence lands. */
  markClean: () => void
}

const initialState: CompositionState = {
  canvas: null,
  layers: [],
  selectedLayerIds: [],
  isDirty: false,
}

/**
 * Revoke a preview object URL if it looks like one. Object URLs always begin
 * with `blob:`; plain strings (e.g. in tests) are left alone. Centralized here
 * so reclaim logic stays consistent.
 *
 * NOTE: revocation is IRREVERSIBLE. `deleteLayer` deliberately does NOT revoke,
 * because undo can revive a deleted layer — a revoked blob would render as a
 * broken image after undo. URLs are reclaimed only at true point-of-no-return
 * operations (`resetComposition` + `clearHistory`), where revived layers can no
 * longer come back. The cost of this deferral is a bounded per-deleted-layer
 * URL leak until the next reset, which is acceptable (reclaimed on tab close).
 */
function revokePreview(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

/**
 * Revoke every preview object URL reachable from the CURRENT composition AND
 * from any history snapshot (past or future). Used at point-of-no-return
 * operations (reset) where revived layers can no longer come back, so their
 * blob bytes can finally be reclaimed. Idempotent on already-revoked URLs.
 *
 * Safe to call before `useCompositionStore` is fully used: it only touches the
 * temporal store at call time, by which point the module is initialized.
 */
function reclaimAllPreviewUrls(): void {
  const seen = new Set<string>()
  const revokeIfNew = (url: string) => {
    if (seen.has(url)) return
    seen.add(url)
    revokePreview(url)
  }
  // Current layers.
  useCompositionStore.getState().layers.forEach((l) => revokeIfNew(l.previewUrl))
  // Snapshots still held in history. (Without the `diff` option every snapshot
  // is a full TrackedComposition, but the zundo types can't see that, so guard
  // for the optional `layers` defensively.)
  const t = useCompositionStore.temporal.getState()
  for (const snap of [...t.pastStates, ...t.futureStates]) {
    snap.layers?.forEach((l) => revokeIfNew(l.previewUrl))
  }
}

export const useCompositionStore = create<CompositionStore>()(
  temporal(
    (set, get) => ({
      ...initialState,

  setBaseImage: (layer) => {
    const prev = get()
    // Do NOT revoke a previous base's previewUrl: undo can restore it, and a
    // revoked blob would render as a broken image. Reclamation is deferred to
    // resetComposition (the only true point-of-no-return).
    // Keep existing overlays; the new base always leads the array at z-index 0.
    const overlays = prev.layers.filter((l) => !l.isBaseImage)
    const base: Layer = {
      ...layer,
      isBaseImage: true,
      zIndex: 0,
      x: 0,
      y: 0,
      width: layer.naturalWidth,
      height: layer.naturalHeight,
    }
    set({
      canvas: { width: layer.naturalWidth, height: layer.naturalHeight },
      layers: [base, ...overlays],
      selectedLayerIds: [base.id],
      isDirty: true,
    })
  },

  addOverlay: (layer) => {
    const layers = get().layers
    // Next z-index = (max existing overlay z-index) + 1, defaulting to 1 so the
    // base's z-index 0 slot is always reserved.
    const maxOverlayZ = layers.reduce(
      (max, l) => (l.isBaseImage ? max : Math.max(max, l.zIndex)),
      0,
    )
    const overlay: Layer = {
      ...layer,
      isBaseImage: false,
      zIndex: maxOverlayZ + 1,
      // Snap the placement math (computed in UploadDropzone) to the half-pixel
      // grid so even a freshly added overlay starts on-grid.
      ...quantizePatch({
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
      }),
    }
    set({
      layers: [...layers, overlay],
      selectedLayerIds: [overlay.id],
      isDirty: true,
    })
  },

  selectLayer: (id, mode = 'replace') =>
    set((state) => {
      if (id === null) return { selectedLayerIds: [] }
      const has = state.selectedLayerIds.includes(id)
      if (mode === 'toggle') {
        return {
          selectedLayerIds: has
            ? state.selectedLayerIds.filter((x) => x !== id)
            : [...state.selectedLayerIds, id],
        }
      }
      if (mode === 'add') {
        return {
          selectedLayerIds: has ? state.selectedLayerIds : [...state.selectedLayerIds, id],
        }
      }
      // replace: a plain click on a layer ALREADY in the selection keeps the set
      // intact so a subsequent drag moves the whole group. Only an unselected
      // target replaces the selection.
      return {
        selectedLayerIds: has ? state.selectedLayerIds : [id],
      }
    }),

  clearSelection: () => set({ selectedLayerIds: [] }),

  updateLayerTransform: (id, patch) =>
    get().updateLayersTransform([{ id, patch }]),

  updateLayersTransform: (updates) =>
    set((state) => {
      if (updates.length === 0) return state
      const patches = new Map(
        updates.map((u) => [u.id, quantizePatch(u.patch)]),
      )
      return {
        layers: state.layers.map((l) => {
          const patch = patches.get(l.id)
          return patch ? { ...l, ...patch } : l
        }),
        isDirty: true,
      }
    }),

  updateLayerOpacity: (id, opacity) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, opacity: Math.min(1, Math.max(0, opacity)) } : l,
      ),
      isDirty: true,
    })),

  resetLayersAspect: (ids) =>
    // Hold each layer's current width, derive height = width / naturalRatio,
    // and shift y so the layer's vertical center stays put (D2 decision).
    // Routed through updateLayersTransform → half-pixel snap + one undo step.
    get().updateLayersTransform(
      get()
        .layers.filter(
          (l) =>
            ids.includes(l.id) &&
            l.naturalWidth > 0 &&
            l.naturalHeight > 0,
        )
        .map((l) => {
          const ratio = l.naturalWidth / l.naturalHeight
          const height = l.width / ratio
          const y = l.y + (l.height - height) / 2
          return { id: l.id, patch: { height, y } }
        }),
    ),

  resetLayersToOriginalSize: (ids) =>
    // Set each layer's rendered width/height back to its source pixel dims,
    // shifting x/y so the layer's CENTER stays put on both axes (a deliberate
    // parallel to reset-aspect, which recenters vertically only). Routed through
    // updateLayersTransform → half-pixel snap + one undo step.
    get().updateLayersTransform(
      get()
        .layers.filter(
          (l) =>
            ids.includes(l.id) &&
            l.naturalWidth > 0 &&
            l.naturalHeight > 0,
        )
        .map((l) => {
          const newW = l.naturalWidth
          const newH = l.naturalHeight
          const x = l.x + (l.width - newW) / 2
          const y = l.y + (l.height - newH) / 2
          return { id: l.id, patch: { width: newW, height: newH, x, y } }
        }),
    ),

  deleteLayer: (id) =>
    set((state) => {
      const target = state.layers.find((l) => l.id === id)
      if (!target) return state
      // NOTE: do NOT revoke target.previewUrl here. Undo can revive this layer,
      // and a revoked blob URL would render as a broken image after undo.
      // Reclamation is deferred to resetComposition / clearHistory.
      return {
        layers: state.layers.filter((l) => l.id !== id),
        selectedLayerIds: state.selectedLayerIds.filter((x) => x !== id),
        isDirty: true,
      }
    }),

  reorderLayer: (fromIndex, toIndex) =>
    set((state) => {
      const { layers } = state
      if (
        fromIndex < 0 ||
        fromIndex >= layers.length ||
        toIndex < 0 ||
        toIndex >= layers.length ||
        fromIndex === toIndex
      ) {
        return state
      }
      const next = layers.slice()
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      // Renumber densely in ascending array order, pinning the base to z-index 0.
      let overlayZ = 1
      const renumbered = next.map((l) => {
        if (l.isBaseImage) return { ...l, zIndex: 0 }
        return { ...l, zIndex: overlayZ++ }
      })
      return { layers: renumbered, isDirty: true }
    }),

  resetComposition: () => {
    // Reclaim every live preview URL — current layers AND any that survive only
    // inside history snapshots (e.g. a deleted layer revived in a past state).
    // Then drop state + wipe history: "Reset" is a one-way trip, not undoable.
    reclaimAllPreviewUrls()
    set({ ...initialState })
    useCompositionStore.temporal.getState().clear()
  },

  markClean: () => set({ isDirty: false }),
    }),
    {
      // Track only the composition — not selection, not isDirty, not actions.
      partialize: (state): TrackedComposition => ({
        canvas: state.canvas,
        layers: state.layers,
      }),
      // Shallow ref-equality on the tracked slice. Every store action produces
      // a NEW `layers` array (via .map()/.filter()/spread), so a changed
      // composition is always detected; a no-op set returns the same ref and
      // is correctly deduped. (Deep equality would also work but is needless
      // work given the store's immutable-update style.)
      equality: (a, b) => a.canvas === b.canvas && a.layers === b.layers,
      limit: HISTORY_LIMIT,
    },
  ),
)
