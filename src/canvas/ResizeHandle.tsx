/**
 * A single pointer target used to resize the selected layer. Eight of these
 * surround the selection (Phase 05). Pointer-down captures the gesture and
 * snapshots the layer's start rect (+ natural dims); pointer-move converts the
 * pointer to canvas units and routes `applyResize` through the store's
 * `updateLayerTransform` seam — the same one drag and the properties form use.
 */
import { useCallback, useRef } from 'react'
import type { RefObject, PointerEvent } from 'react'
import { useCompositionStore } from '../state/compositionStore'
import type { TrackedComposition } from '../state/compositionStore'
import { beginGesture, commitGesture } from '../state/useTemporalStore'
import { screenToCanvas } from './coords'
import { applyResize } from './resize'
import type { ResizeHandleId, ResizeStart } from './resize'

export interface ResizeHandleProps {
  handleId: ResizeHandleId
  /** Handle center x in canvas units. */
  cx: number
  /** Handle center y in canvas units. */
  cy: number
  /** Handle edge length in canvas units. */
  size: number
  /** CSS cursor for this handle's direction. */
  cursor: string
  /** The selected layer being resized. */
  layerId: string
  /** The canvas <svg> ref, used for screen→canvas conversion. */
  svgRef: RefObject<SVGSVGElement | null>
}

interface ResizeGesture {
  pointerId: number
  handle: ResizeHandleId
  start: ResizeStart
  /** Pre-gesture composition snapshot — the whole resize collapses to ONE undo
   *  step via commitGesture on pointer-up. */
  historySnapshot: TrackedComposition
}

export function ResizeHandle({
  handleId,
  cx,
  cy,
  size,
  cursor,
  layerId,
  svgRef,
}: ResizeHandleProps) {
  const updateLayerTransform = useCompositionStore(
    (s) => s.updateLayerTransform,
  )
  const gesture = useRef<ResizeGesture | null>(null)

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.button !== 0) return // primary button only
      // Stop propagation so this never also triggers a layer drag or a
      // background deselect — the handle is the sole target of this gesture.
      e.stopPropagation()
      const svg = svgRef.current
      if (!svg) return
      const layer = useCompositionStore
        .getState()
        .layers.find((l) => l.id === layerId)
      if (!layer) return
      gesture.current = {
        pointerId: e.pointerId,
        handle: handleId,
        start: {
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
          naturalWidth: layer.naturalWidth,
          naturalHeight: layer.naturalHeight,
        },
        // Snapshot before the first move + pause history so the burst of
        // per-move resize writes collapses to one undo step on pointer-up.
        historySnapshot: beginGesture(),
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [handleId, layerId, svgRef],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const g = gesture.current
      if (!g || g.pointerId !== e.pointerId) return
      const svg = svgRef.current
      if (!svg) return
      const pointer = screenToCanvas(svg, e.clientX, e.clientY)
      const next = applyResize(g.handle, g.start, pointer)
      updateLayerTransform(layerId, next)
    },
    [layerId, svgRef, updateLayerTransform],
  )

  const endResize = useCallback((e: PointerEvent) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    gesture.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Capture may already be gone; gesture already cleared.
    }
    // Collapse the whole resize into a single undo step (no-op if the pointer
    // never moved).
    commitGesture(g.historySnapshot)
  }, [])

  const half = size / 2
  return (
    <rect
      x={cx - half}
      y={cy - half}
      width={size}
      height={size}
      fill="#ffffff"
      stroke="#2563eb"
      // Constant screen-pixel stroke regardless of viewBox scale (matches the
      // selection outline + export-crop boundary).
      vectorEffect="non-scaling-stroke"
      strokeWidth={1.25}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endResize}
      onPointerCancel={endResize}
      data-handle={handleId}
    />
  )
}
