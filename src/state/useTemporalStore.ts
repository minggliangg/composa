/**
 * Reactive + imperative access to the composition store's undo/redo history
 * (zundo `temporal` middleware).
 *
 * zundo does NOT export a ready-made React hook for the temporal store; the
 * docs prescribe defining one with `useStoreWithEqualityFn` (zustand/traditional)
 * bound to `useCompositionStore.temporal`. That is `useTemporalStore` below.
 *
 * The module also exposes the gesture-coalescing helpers (`beginGesture` /
 * `commitGesture`) used by the canvas pointer hooks. Why a custom commit rather
 * than zundo's stock `pause()`/`resume()`: an empirical probe (see the plan's
 * §A.7 risk) showed that with zundo 2.x a paused→mutated→resumed run records
 * NOTHING on its own, and the naive "touch-write after resume" captures the
 * POST-gesture state as the history entry — so the first undo becomes a no-op.
 * The commit-only pattern below captures the PRE-gesture tracked slice at
 * gesture start and, if the gesture produced a net change, pushes that slice
 * onto `pastStates` directly on pointer-up. Result: exactly one history entry
 * per gesture, and one undo cleanly reverts the whole gesture.
 */
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useCompositionStore } from './compositionStore'
import type { TrackedComposition } from './compositionStore'
import type { TemporalState } from 'zundo'
import { HISTORY_LIMIT } from './compositionStore'

/**
 * Subscribe a component to the temporal (history) store. Selector results are
 * compared with the optional `equality` fn (defaults to `Object.is`).
 *
 * Use this for reactive UI (Undo/Redo button disabled state); for one-off
 * imperative calls inside event handlers (undo/redo/pause/commit), read
 * `useCompositionStore.temporal.getState()` directly to avoid re-subscribing.
 */
export function useTemporalStore<T>(
  selector: (state: TemporalState<TrackedComposition>) => T,
  equality?: (a: T, b: T) => boolean,
): T {
  return useStoreWithEqualityFn(
    useCompositionStore.temporal,
    selector,
    equality ?? Object.is,
  )
}

/**
 * Read the current tracked slice (canvas + layers) as a stable snapshot. The
 * returned object is freshly allocated so it won't be mutated by later store
 * updates — safe to hold across a gesture.
 */
export function snapshotTracked(): TrackedComposition {
  const s = useCompositionStore.getState()
  return { canvas: s.canvas, layers: s.layers }
}

/**
 * Begin a coalesced gesture: snapshot the pre-gesture composition and pause
 * history tracking so the high-frequency pointer-move writes don't each become
 * a history entry. Returns the snapshot to hand to `commitGesture`.
 *
 * Call on pointer-down, AFTER resolving selection but BEFORE the first move.
 */
export function beginGesture(): TrackedComposition {
  const before = snapshotTracked()
  useCompositionStore.temporal.getState().pause()
  return before
}

/**
 * End a coalesced gesture: resume tracking and, if the composition actually
 * changed during the gesture, push the PRE-gesture snapshot onto `pastStates`
 * as a single history entry (clearing `futureStates`, honoring the limit).
 *
 * If the gesture produced no net change (pointer-down with no move), nothing is
 * recorded — the snapshot is discarded and history is untouched.
 *
 * Call on pointer-up / pointer-cancel.
 */
export function commitGesture(before: TrackedComposition): void {
  const temporal = useCompositionStore.temporal
  // Resume first so our direct setState below isn't itself ignored, and so
  // subsequent discrete actions are tracked normally.
  temporal.getState().resume()
  const after = snapshotTracked()
  // No net change → no history entry. (Ref-equality is correct here: the store
  // always allocates a new `layers` array on mutation.)
  if (before.canvas === after.canvas && before.layers === after.layers) return
  const t = temporal.getState()
  temporal.setState({
    pastStates: [...t.pastStates, before].slice(-HISTORY_LIMIT),
    futureStates: [],
  })
}

/** Convenience: undo/redo from inside an event handler (no subscription). */
export function undo(steps = 1): void {
  useCompositionStore.temporal.getState().undo(steps)
}
export function redo(steps = 1): void {
  useCompositionStore.temporal.getState().redo(steps)
}
