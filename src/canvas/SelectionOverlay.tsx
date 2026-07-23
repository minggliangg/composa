/**
 * Selection outline + eight resize handles drawn around the SELECTED layer
 * (Phase 04 outline + Phase 05 handles). Reads `selectedLayerId` from the store
 * and, if it resolves to a non-base layer, renders a stroked `<rect>` outline
 * plus one `<ResizeHandle>` at each corner/edge, positioned in canvas units so
 * they scale with the SVG.
 *
 * The base image is excluded (it is the non-interactive canvas background).
 */
import type { RefObject } from 'react'
import { useCompositionStore } from '../state/compositionStore'
import { ResizeHandle } from './ResizeHandle'
import type { ResizeHandleId } from './resize'

export interface SelectionOverlayProps {
  /** The canvas <svg> ref, threaded through to each resize handle. */
  svgRef: RefObject<SVGSVGElement | null>
}

/** Handle size as a fraction of the canvas's smaller dimension. */
const HANDLE_SIZE_RATIO = 1 / 30

interface HandlePlacement {
  id: ResizeHandleId
  cx: number
  cy: number
  cursor: string
}

export function SelectionOverlay({ svgRef }: SelectionOverlayProps) {
  const layers = useCompositionStore((s) => s.layers)
  const selectedLayerId = useCompositionStore((s) => s.selectedLayerId)
  const canvas = useCompositionStore((s) => s.canvas)

  if (!selectedLayerId || !canvas) return null
  const layer = layers.find((l) => l.id === selectedLayerId)
  if (!layer || !layer.visible) return null
  // The base image is the background and is not resizable on the canvas.
  if (layer.isBaseImage) return null

  const { x, y, width, height } = layer
  const handleSize = Math.max(
    10,
    Math.min(canvas.width, canvas.height) * HANDLE_SIZE_RATIO,
  )

  const placements: HandlePlacement[] = [
    { id: 'nw', cx: x, cy: y, cursor: 'nwse-resize' },
    { id: 'n', cx: x + width / 2, cy: y, cursor: 'ns-resize' },
    { id: 'ne', cx: x + width, cy: y, cursor: 'nesw-resize' },
    { id: 'e', cx: x + width, cy: y + height / 2, cursor: 'ew-resize' },
    { id: 'se', cx: x + width, cy: y + height, cursor: 'nwse-resize' },
    { id: 's', cx: x + width / 2, cy: y + height, cursor: 'ns-resize' },
    { id: 'sw', cx: x, cy: y + height, cursor: 'nesw-resize' },
    { id: 'w', cx: x, cy: y + height / 2, cursor: 'ew-resize' },
  ]

  return (
    <g>
      {/* Selection outline: visual only. pointerEvents="none" so clicks inside
          the selection still reach the layer beneath (for dragging). */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke="#2563eb"
        strokeWidth={Math.max(1, handleSize * 0.12)}
        pointerEvents="none"
      />
      {placements.map((p) => (
        <ResizeHandle
          key={p.id}
          handleId={p.id}
          cx={p.cx}
          cy={p.cy}
          size={handleSize}
          cursor={p.cursor}
          layerId={layer.id}
          svgRef={svgRef}
        />
      ))}
    </g>
  )
}
