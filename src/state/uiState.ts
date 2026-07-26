import { create } from 'zustand'

/**
 * Ephemeral UI state that history should NEVER see.
 *
 * This is a standalone store, intentionally separate from `compositionStore`
 * (which is wrapped in zundo's temporal middleware). The status footer needs a
 * couple of values that are pure presentation — the canvas's current fit-to-
 * panel scale, and the timestamp of the last successful export — and neither
 * belongs in a composition snapshot. Keeping them here means:
 *   - no change to `CompositionState` / the tracked `{ canvas, layers }` slice,
 *   - undo/redo never touches them,
 *   - and high-frequency re-measures of `scale` (panel resize) don't churn the
 *     temporal history.
 *
 * Publishers:
 *   - `CompositionCanvas` writes `scale` every time its fitted scale changes.
 *   - `TopBar` writes `lastSavedAt` on a successful export (alongside `markClean`).
 * Subscriber:
 *   - `StatusBar` reads both.
 */
export interface UiState {
  /** Screen-px-per-canvas-unit of the editor `<svg>` (1 until first measured). */
  scale: number
  /** Epoch ms of the last successful export, or null if never saved. */
  lastSavedAt: number | null
  /** Publish the current fitted canvas scale (called from CompositionCanvas). */
  setScale: (scale: number) => void
  /** Stamp a successful save/export (called from TopBar). */
  markSaved: () => void
}

export const useUiState = create<UiState>((set) => ({
  scale: 1,
  lastSavedAt: null,
  setScale: (scale) => set((prev) => (prev.scale === scale ? prev : { scale })),
  markSaved: () => set({ lastSavedAt: Date.now() }),
}))
