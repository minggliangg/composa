import { create } from 'zustand'
import type { CompositionState, Layer } from '../types/layer'

/**
 * Zustand composition store — the single source of truth every UI surface reads
 * from and writes through. Centralized named actions keep a clean seam for a
 * future undo middleware (undo/redo itself is out of scope for MVP).
 *
 * Selectors should stay granular (e.g. `s => s.canvas`) so only the components
 * that actually depend on a slice re-render — important for the high-frequency
 * transform updates that arrive in Phase 04+.
 */

export interface CompositionStore extends CompositionState {
  /** Set/replace the base image. Canvas adopts the base's natural pixel size. */
  setBaseImage: (layer: Layer) => void
  /** Append an overlay; assigns the next dense z-index so it paints on top. */
  addOverlay: (layer: Layer) => void
  /** Set the selected layer id (or null to clear). */
  selectLayer: (id: string | null) => void
  /** Merge a partial transform patch into a layer; the seam all transforms use. */
  updateLayerTransform: (
    id: string,
    patch: Partial<Pick<Layer, 'x' | 'y' | 'width' | 'height'>>,
  ) => void
  /** Remove a layer; clears selection if it was the selected one. */
  deleteLayer: (id: string) => void
  /** Move a layer within the array and renumber z-indices densely (base stays 0). */
  reorderLayer: (fromIndex: number, toIndex: number) => void
  /** Clear the whole composition back to its initial empty state. */
  resetComposition: () => void
}

const initialState: CompositionState = {
  canvas: null,
  layers: [],
  selectedLayerId: null,
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
      selectedLayerId: base.id,
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
    }
    set({
      layers: [...layers, overlay],
      selectedLayerId: overlay.id,
      isDirty: true,
    })
  },

  selectLayer: (id) => set({ selectedLayerId: id }),

  updateLayerTransform: (id, patch) =>
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, ...patch } : l,
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
        selectedLayerId:
          state.selectedLayerId === id ? null : state.selectedLayerId,
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
