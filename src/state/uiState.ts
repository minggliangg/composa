import { create } from 'zustand'
import { clampZoom, zoomAtPoint } from '../canvas/viewport'
import type { ViewPoint } from '../canvas/viewport'

/**
 * Ephemeral UI state that history should NEVER see.
 *
 * This is a standalone store, intentionally separate from `compositionStore`
 * (which is wrapped in zundo's temporal middleware). It holds pure-presentation
 * values — the canvas's current fit-to-panel scale, the timestamp of the last
 * successful export, and the viewport's zoom/pan — none of which belong in a
 * composition snapshot. Keeping them here means:
 *   - no change to `CompositionState` / the tracked `{ canvas, layers }` slice,
 *   - undo/redo never touches them (a zoom level is NOT a composition edit),
 *   - and high-frequency re-measures of `scale` (panel resize) don't churn the
 *     temporal history.
 *
 * Publishers:
 *   - `CompositionCanvas` writes `scale`, the viewport `zoom`/`pan`, and the
 *     space-bar `spaceHeld` flag (for pan-cursor styling + pointer-bail).
 *   - `TopBar` writes `lastSavedAt` on a successful export (alongside `markClean`).
 *   - `StatusBar` writes `zoom`/`pan` via the zoom controls.
 * Subscriber:
 *   - `StatusBar` reads all of the above; `CompositionCanvas` reads the viewport.
 */
export interface UiState {
  /** Screen-px-per-canvas-unit of the editor `<svg>` (1 until first measured). */
  scale: number
  /** Epoch ms of the last successful export, or null if never saved. */
  lastSavedAt: number | null
  /** Viewport user-multiplier; 1 = fit-to-panel (no zoom). */
  zoom: number
  /** Viewport translation in screen px. */
  pan: ViewPoint
  /** Is the Space bar currently held? Drives pan cursor + pointer-bail. */
  spaceHeld: boolean
  /** Publish the current fitted canvas scale (called from CompositionCanvas). */
  setScale: (scale: number) => void
  /** Stamp a successful save/export (called from TopBar). */
  markSaved: () => void
  /** Set the zoom multiplier (clamped). Pan is left unchanged. */
  setZoom: (zoom: number) => void
  /** Zoom by `factor` about an origin-relative `anchor` (omit → zoom about the
   *  center, i.e. anchor {0,0}). */
  zoomBy: (factor: number, anchor?: ViewPoint) => void
  /** Set the viewport pan directly. */
  setPan: (pan: ViewPoint) => void
  /** Reset zoom to 1 and pan to {0,0} (fit-to-panel). */
  resetView: () => void
  /** Record whether the Space bar is held (for pan cursor + pointer-bail). */
  setSpaceHeld: (held: boolean) => void
}

export const useUiState = create<UiState>((set) => ({
  scale: 1,
  lastSavedAt: null,
  zoom: 1,
  pan: { x: 0, y: 0 },
  spaceHeld: false,
  setScale: (scale) => set((prev) => (prev.scale === scale ? prev : { scale })),
  markSaved: () => set({ lastSavedAt: Date.now() }),
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  zoomBy: (factor, anchor) =>
    set((s) => {
      const a = anchor ?? { x: 0, y: 0 }
      const { zoom, pan } = zoomAtPoint(s.zoom, s.pan, factor, a)
      return { zoom, pan }
    }),
  setPan: (pan) => set({ pan }),
  resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 } }),
  setSpaceHeld: (held) => set((prev) => (prev.spaceHeld === held ? prev : { spaceHeld: held })),
}))
