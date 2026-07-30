/**
 * Selection chrome drawn on top of the canvas: a stroked outline around every
 * selected (non-base) layer, plus eight resize handles on the PRIMARY selected
 * layer when exactly one layer is selected (resize is single-layer only —
 * resizing a group is ambiguous).
 *
 * Reads `selectedLayerIds` from the store; the LAST id is the primary (anchor).
 * Handles + outlines are sized in SCREEN pixels (constant regardless of the
 * canvas's natural size or panel fit) by dividing a target px by the live
 * canvas→screen scale.
 *
 * The base image is excluded (it is the non-interactive canvas background).
 */
import type { RefObject } from 'react'
import { useCompositionStore } from '../state/compositionStore'
import { useUiState } from '../state/uiState'
import { ResizeHandle } from './ResizeHandle'
import { useCanvasScale } from './useCanvasScale'
import type { ResizeHandleId } from './resize'
import type { Layer } from '../types/layer'

export interface SelectionOverlayProps {
  /** The canvas <svg> ref, threaded through to each resize handle. */
  svgRef: RefObject<SVGSVGElement | null>
}

/** Resize handle edge length in SCREEN pixels (constant regardless of zoom). */
const HANDLE_SIZE_PX = 10
/** Selection outline thickness in SCREEN pixels. */
const OUTLINE_STROKE_PX = 1.5

interface HandlePlacement {
  id: ResizeHandleId
  cx: number
  cy: number
  cursor: string
}

/** The eight handle placements around a layer rect, in canvas units. */
function handlePlacements(layer: Layer): HandlePlacement[] {
  const { x, y, width, height } = layer
  return [
    { id: 'nw', cx: x, cy: y, cursor: 'nwse-resize' },
    { id: 'n', cx: x + width / 2, cy: y, cursor: 'ns-resize' },
    { id: 'ne', cx: x + width, cy: y, cursor: 'nesw-resize' },
    { id: 'e', cx: x + width, cy: y + height / 2, cursor: 'ew-resize' },
    { id: 'se', cx: x + width, cy: y + height, cursor: 'nwse-resize' },
    { id: 's', cx: x + width / 2, cy: y + height, cursor: 'ns-resize' },
    { id: 'sw', cx: x, cy: y + height, cursor: 'nesw-resize' },
    { id: 'w', cx: x, cy: y + height / 2, cursor: 'ew-resize' },
  ]
}

export function SelectionOverlay({ svgRef }: SelectionOverlayProps) {
  // All hooks first — never conditionally. `useCanvasScale` is safe to call with
  // a null canvas (it returns 1 until measurable).
  const layers = useCompositionStore((s) => s.layers)
  const selectedLayerIds = useCompositionStore((s) => s.selectedLayerIds)
  const canvas = useCompositionStore((s) => s.canvas)
  const zoom = useUiState((s) => s.zoom)
  const scale = useCanvasScale(svgRef, canvas, zoom)

  if (!canvas) return null

  // Resolve selected ids to layers, dropping the base and any that vanished.
  const selected = selectedLayerIds
    .map((id) => layers.find((l) => l.id === id))
    .filter((l): l is Layer => Boolean(l))
    .filter((l) => l.visible && !l.isBaseImage)
  if (selected.length === 0) return null

  // Size handles in canvas units so they render at a constant ~HANDLE_SIZE_PX
  // on screen regardless of the canvas's natural pixel size or panel fit.
  const handleSize = HANDLE_SIZE_PX / scale
  const primary = selected[selected.length - 1]
  const single = selected.length === 1

  return (
    <g>
      {/* One outline per selected layer. pointerEvents="none" so clicks inside a
          selection still reach the layer beneath (for dragging). */}
      {selected.map((layer) => (
        <rect
          key={layer.id}
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          fill="none"
          stroke="var(--accent)"
          // Constant screen-pixel stroke regardless of viewBox scale (same trick
          // as the export-crop boundary), so the outline stays a crisp thin line
          // on both a 200px and a 12000px canvas.
          vectorEffect="non-scaling-stroke"
          strokeWidth={OUTLINE_STROKE_PX}
          pointerEvents="none"
        />
      ))}
      {/* Resize handles target the primary layer, and only when exactly one layer
          is selected. */}
      {single &&
        handlePlacements(primary).map((p) => (
          <ResizeHandle
            key={p.id}
            handleId={p.id}
            cx={p.cx}
            cy={p.cy}
            size={handleSize}
            cursor={p.cursor}
            layerId={primary.id}
            svgRef={svgRef}
          />
        ))}
    </g>
  )
}
