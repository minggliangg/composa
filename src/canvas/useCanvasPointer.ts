/**
 * Pointer-event DRAG hook (Phase 04). Implements click-to-select + drag-to-move
 * for an overlay layer, routing every transform through the store's
 * `updateLayerTransform` seam.
 *
 * Design:
 *   - On pointerdown: select the layer, snapshot its live x/y and the pointer's
 *     canvas position, and `setPointerCapture` so subsequent moves (and the
 *     release) keep targeting this element even if the pointer leaves it.
 *   - On pointermove: convert the pointer to canvas units, compute the delta
 *     from the snapshot, and write the new x/y through `applyDrag`.
 *   - On pointerup/cancel: release capture and clear the gesture.
 *
 * Coordinates are NOT clamped — off-canvas dragging is allowed (plan §4);
 * viewport clipping handles it at export time.
 */
import { useCallback, useRef } from 'react'
import type { RefObject, PointerEvent } from 'react'
import type { Layer } from '../types/layer'
import { useCompositionStore } from '../state/compositionStore'
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

interface DragState {
  pointerId: number
  startPointer: CanvasPoint
  startLayerX: number
  startLayerY: number
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
  const selectLayer = useCompositionStore((s) => s.selectLayer)
  const updateLayerTransform = useCompositionStore(
    (s) => s.updateLayerTransform,
  )
  const drag = useRef<DragState | null>(null)

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.button !== 0) return // primary button only
      const svg = svgRef.current
      if (!svg) return
      // Read the LIVE layer transform from the store so the gesture anchors to
      // the actual current position, never a stale render closure.
      const current = useCompositionStore
        .getState()
        .layers.find((l) => l.id === layer.id)
      if (!current) return
      selectLayer(layer.id)
      drag.current = {
        pointerId: e.pointerId,
        startPointer: screenToCanvas(svg, e.clientX, e.clientY),
        startLayerX: current.x,
        startLayerY: current.y,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [layer.id, selectLayer, svgRef],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current
      if (!d || d.pointerId !== e.pointerId) return
      const svg = svgRef.current
      if (!svg) return
      const p = screenToCanvas(svg, e.clientX, e.clientY)
      const next = applyDrag(
        d.startLayerX,
        d.startLayerY,
        p.x - d.startPointer.x,
        p.y - d.startPointer.y,
      )
      updateLayerTransform(layer.id, next)
    },
    [layer.id, svgRef, updateLayerTransform],
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
