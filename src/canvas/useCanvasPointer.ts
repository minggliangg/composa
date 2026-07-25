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
 * Coordinates are NOT clamped — off-canvas dragging is allowed (plan §4);
 * viewport clipping handles it at export time. Values are snapped to the
 * half-pixel grid at the store seam.
 */
import { useCallback, useRef } from 'react'
import type { RefObject, PointerEvent } from 'react'
import type { Layer } from '../types/layer'
import { useCompositionStore } from '../state/compositionStore'
import { selectionModeFromEvent } from '../state/selection'
import { screenToCanvas } from './coords'
import type { CanvasPoint } from './coords'

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
}

interface DragState {
  pointerId: number
  startPointer: CanvasPoint
  layers: DragLayer[]
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

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.button !== 0) return // primary button only
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

      // Snapshot every selected NON-BASE layer's live position. Read fresh from
      // the store (selectLayer above already applied, synchronously).
      const after = useCompositionStore.getState()
      const selectedIds = after.selectedLayerIds
      const movers = after.layers
        .filter((l) => selectedIds.includes(l.id) && !l.isBaseImage)
        .map((l): DragLayer => ({ id: l.id, startX: l.x, startY: l.y }))
      if (movers.length === 0) return

      drag.current = {
        pointerId: e.pointerId,
        startPointer: screenToCanvas(svg, e.clientX, e.clientY),
        layers: movers,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [layer.id, svgRef],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current
      if (!d || d.pointerId !== e.pointerId) return
      const svg = svgRef.current
      if (!svg) return
      const p = screenToCanvas(svg, e.clientX, e.clientY)
      const dx = p.x - d.startPointer.x
      const dy = p.y - d.startPointer.y
      // Apply the same delta to every snapshotted layer; the store snaps each
      // result to the half-pixel grid.
      useCompositionStore.getState().updateLayersTransform(
        d.layers.map((s) => ({
          id: s.id,
          patch: applyDrag(s.startX, s.startY, dx, dy),
        })),
      )
    },
    [svgRef],
  )

  const endDrag = useCallback((e: PointerEvent) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Release can throw if capture was already lost (e.g. pointercancel
      // fired first); safe to ignore — the gesture is already cleared.
    }
  }, [])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  }
}
