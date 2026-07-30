/**
 * Pointer-event DRAG hook. Implements click-to-select (with multi-select
 * modifiers) + drag-to-move, routing every transform through the store's
 * `updateLayersTransform` seam.
 *
 * Selection (resolved on pointerdown BEFORE snapshotting, reading the live store
 * so the gesture anchors to current state):
 *   - modifier (shift / meta / ctrl): TOGGLE this layer in the selection.
 *   - plain click on an unselected layer: REPLACE the selection with it.
 *   - plain click on a layer already in the selection: KEEP the set, so a
 *     subsequent drag moves the whole group.
 *
 * Drag: snapshots the live x/y of every selected NON-BASE layer on pointerdown,
 * then on each move applies the same canvas-unit delta to all of them. A single
 * pointer capture on the clicked element is enough — only that element's
 * onPointerMove fires, and it writes the entire group. (Multi-select never
 * includes the base: the base is `pointerEvents:none` on the canvas.)
 *
 * Snap (hold Alt, or invert via the StatusBar toggle): while a snap mode is
 * effective, the drag delta is nudged so the group's edges/centre align to the
 * canvas or a static target layer, and alignment guides are published to
 * `uiState.snapGuides` for `SnapGuides` to render. `snapEnabled !== altKey`
 * means Alt INVERTS the current default (free by default, Alt to snap). Alt
 * keydown/keyup listeners re-run the move from the last pointer position, so
 * guides appear/disappear the instant Alt toggles even with the pointer held
 * still; the live `altKey` is read off the event so Alt+Tab mid-drag can't
 * strand a stale modifier.
 *
 * Coordinates are NOT clamped — off-canvas dragging is allowed (plan §4);
 * viewport clipping handles it at export time. Values are snapped to the
 * half-pixel grid at the store seam.
 */
import { useCallback, useRef } from 'react'
import type { RefObject, PointerEvent } from 'react'
import type { Layer } from '../types/layer'
import { useCompositionStore } from '../state/compositionStore'
import type { TrackedComposition } from '../state/compositionStore'
import { beginGesture, commitGesture } from '../state/useTemporalStore'
import { selectionModeFromEvent } from '../state/selection'
import { useUiState } from '../state/uiState'
import { screenToCanvas } from './coords'
import type { CanvasPoint } from './coords'
import { computeSnap, SNAP_THRESHOLD_PX } from './snap'
import type { SnapRect, SnapGuide } from './snap'

/** Stable empty sentinel so clearing guides is an identity no-op in the store. */
const NO_GUIDES: SnapGuide[] = []

/**
 * Pure drag math: new top-left = start top-left + canvas-unit delta.
 *
 * Deliberately NOT clamped — off-canvas positions are allowed (plan §4) and
 * handled by viewport clipping at export time. Extracted so the movement-delta
 * math is unit-testable without any React/DOM machinery.
 */
export function applyDrag(
  startX: number,
  startY: number,
  deltaCanvasX: number,
  deltaCanvasY: number,
): { x: number; y: number } {
  return { x: startX + deltaCanvasX, y: startY + deltaCanvasY }
}

interface DragLayer {
  id: string
  startX: number
  startY: number
  width: number
  height: number
}

interface DragState {
  pointerId: number
  startPointer: CanvasPoint
  layers: DragLayer[]
  /** Pre-gesture composition snapshot, captured on pointer-down so the whole
   *  drag collapses to ONE undo step on pointer-up (see commitGesture). */
  historySnapshot: TrackedComposition
  /** Static snap targets (other visible non-base layers), snapshotted at start. */
  targets: SnapRect[]
  /** Bounding box of the moving layers at drag start — the snap "moving box". */
  groupBbox: SnapRect
  /** Last pointer client coords, so an Alt toggle can re-run the move in place. */
  lastClient: { x: number; y: number }
  /** Removes the Alt keydown/keyup listeners installed for this drag. */
  cleanup: () => void
}

export interface CanvasPointerHandlers {
  onPointerDown: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
  onPointerCancel: (e: PointerEvent) => void
}

/**
 * Returns pointer handlers to spread onto a layer's interactive element.
 * `svgRef` is the canvas `<svg>` (used for screen→canvas conversion); it should
 * be the same ref the parent `<svg>` is rendered with.
 */
export function useCanvasPointer(
  layer: Layer,
  svgRef: RefObject<SVGSVGElement | null>,
): CanvasPointerHandlers {
  const drag = useRef<DragState | null>(null)

  /**
   * Core move: convert client coords to a canvas delta, optionally snap it,
   * publish guides, and write the group transform. Shared by the pointer-move
   * handler and the Alt-toggle recompute. `altKey` is read off the triggering
   * event (pointer OR keyboard) so it always reflects the live modifier state.
   */
  const applyMove = useCallback(
    (clientX: number, clientY: number, altKey: boolean) => {
      const d = drag.current
      if (!d) return
      const svg = svgRef.current
      if (!svg) return
      const ui = useUiState.getState()
      const canvas = useCompositionStore.getState().canvas
      const p = screenToCanvas(svg, clientX, clientY)
      let dx = p.x - d.startPointer.x
      let dy = p.y - d.startPointer.y
      // Alt INVERTS the default snap mode: effective = snapEnabled XOR altKey.
      const snapActive = ui.snapEnabled !== altKey
      if (snapActive && canvas) {
        // Threshold shrinks with zoom so the tolerance is constant in screen px.
        const snap = computeSnap(
          d.groupBbox,
          d.targets,
          canvas,
          dx,
          dy,
          SNAP_THRESHOLD_PX / ui.scale,
        )
        dx = snap.dx
        dy = snap.dy
        ui.setSnapGuides(snap.guides.length > 0 ? snap.guides : NO_GUIDES)
      } else {
        ui.setSnapGuides(NO_GUIDES)
      }
      // Apply the (possibly nudged) delta to every snapshotted layer; the store
      // snaps each result to the half-pixel grid.
      useCompositionStore.getState().updateLayersTransform(
        d.layers.map((s) => ({
          id: s.id,
          patch: applyDrag(s.startX, s.startY, dx, dy),
        })),
      )
    },
    [svgRef],
  )

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      // Primary button only, and never when Space is held — a space-drag pans
      // the viewport (handled at the canvas level) rather than moving a layer.
      // Read `spaceHeld` fresh from the store (not subscribed) so this costs no
      // re-render per layer.
      if (e.button !== 0) return
      if (useUiState.getState().spaceHeld) return
      const svg = svgRef.current
      if (!svg) return

      const store = useCompositionStore.getState()
      const mode = selectionModeFromEvent(e)
      const isSel = store.selectedLayerIds.includes(layer.id)
      // Resolve the post-click selection before snapshotting positions. Plain
      // click on an already-selected layer keeps the set (group drag).
      if (mode === 'toggle') {
        store.selectLayer(layer.id, 'toggle')
      } else if (!isSel) {
        store.selectLayer(layer.id, 'replace')
      }

      // Snapshot every selected NON-BASE layer's live position + size. Read fresh
      // from the store (selectLayer above already applied, synchronously).
      const after = useCompositionStore.getState()
      const selectedIds = after.selectedLayerIds
      const movers = after.layers
        .filter((l) => selectedIds.includes(l.id) && !l.isBaseImage)
        .map(
          (l): DragLayer => ({
            id: l.id,
            startX: l.x,
            startY: l.y,
            width: l.width,
            height: l.height,
          }),
        )
      if (movers.length === 0) return

      // Snap targets: every OTHER visible non-base layer (the base's edges are
      // congruent with the canvas, so it only emits duplicate lines). Snapshotted
      // here — they don't move during this drag.
      const movingIds = new Set(movers.map((m) => m.id))
      const targets: SnapRect[] = after.layers
        .filter((l) => !movingIds.has(l.id) && l.visible && !l.isBaseImage)
        .map((l) => ({
          x: l.x,
          y: l.y,
          width: l.width,
          height: l.height,
        }))

      // Group bbox of the movers at start = the snap "moving box".
      const minX = Math.min(...movers.map((m) => m.startX))
      const minY = Math.min(...movers.map((m) => m.startY))
      const maxX = Math.max(...movers.map((m) => m.startX + m.width))
      const maxY = Math.max(...movers.map((m) => m.startY + m.height))
      const groupBbox: SnapRect = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      }

      // Alt toggles re-run the move from the last pointer position so guides
      // appear/disappear the instant Alt is pressed, even with the pointer held
      // still. Reads `altKey` off the keyboard event (live, not a tracked flag).
      const recompute = (ke: KeyboardEvent) => {
        if (ke.key !== 'Alt') return
        const d = drag.current
        if (!d) return
        applyMove(d.lastClient.x, d.lastClient.y, ke.altKey)
      }
      window.addEventListener('keydown', recompute)
      window.addEventListener('keyup', recompute)

      drag.current = {
        pointerId: e.pointerId,
        startPointer: screenToCanvas(svg, e.clientX, e.clientY),
        layers: movers,
        // Snapshot the composition now (before the first move) and pause history
        // so the burst of per-move writes doesn't flood undo. pointer-up commits
        // the net change as a single entry.
        historySnapshot: beginGesture(),
        targets,
        groupBbox,
        lastClient: { x: e.clientX, y: e.clientY },
        cleanup: () => {
          window.removeEventListener('keydown', recompute)
          window.removeEventListener('keyup', recompute)
        },
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [layer.id, svgRef, applyMove],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current
      if (!d || d.pointerId !== e.pointerId) return
      d.lastClient = { x: e.clientX, y: e.clientY }
      applyMove(e.clientX, e.clientY, e.altKey)
    },
    [applyMove],
  )

  const endDrag = useCallback(
    (e: PointerEvent) => {
      const d = drag.current
      if (!d || d.pointerId !== e.pointerId) return
      drag.current = null
      d.cleanup()
      // Guides are drag-only; clear them on release.
      useUiState.getState().setSnapGuides(NO_GUIDES)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // Release can throw if capture was already lost (e.g. pointercancel
        // fired first); safe to ignore — the gesture is already cleared.
      }
      // Collapse the whole drag into a single undo step. If the pointer never
      // moved, commitGesture detects the no-op and records nothing.
      commitGesture(d.historySnapshot)
    },
    [],
  )

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  }
}
