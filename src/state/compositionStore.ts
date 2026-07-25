import { create } from 'zustand'
import type { CompositionState, Layer } from '../types/layer'
import type { SelectionMode } from './selection'
import { quantizePatch } from '../canvas/quantize'

/**
 * Zustand composition store — the single source of truth every UI surface reads
 * from and writes through. Centralized named actions keep a clean seam for a
 * future undo middleware (undo/redo itself is out of scope for MVP).
 *
 * Selectors should stay granular (e.g. `s => s.canvas`) so only the components
 * that actually depend on a slice re-render — important for the high-frequency
 * transform updates that arrive in Phase 04+.
 */

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
  /** Remove a layer; drops it from the selection if present. */
  deleteLayer: (id: string) => void
  /** Move a layer within the array and renumber z-indices densely (base stays 0). */
  reorderLayer: (fromIndex: number, toIndex: number) => void
  /** Clear the whole composition back to its initial empty state. */
  resetComposition: () => void
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
 * so every action that drops a layer reclaims its preview bytes consistently.
 */
function revokePreview(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

export const useCompositionStore = create<CompositionStore>()((set, get) => ({
  ...initialState,

  setBaseImage: (layer) => {
    const prev = get()
    const oldBase = prev.layers.find((l) => l.isBaseImage)
    if (oldBase) revokePreview(oldBase.previewUrl)
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

  deleteLayer: (id) =>
    set((state) => {
      const target = state.layers.find((l) => l.id === id)
      if (!target) return state
      revokePreview(target.previewUrl)
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
    // Reclaim every live preview URL before dropping references.
    get().layers.forEach((l) => revokePreview(l.previewUrl))
    set({ ...initialState })
  },
}))
