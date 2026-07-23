import type { RefObject } from 'react'
import type { Layer } from '../types/layer'
import { useCanvasPointer } from './useCanvasPointer'

export interface LayerImageProps {
  layer: Layer
  /** The canvas <svg> ref, used for screen→canvas conversion during drag. */
  svgRef: RefObject<SVGSVGElement | null>
}

/**
 * Renders a single layer as an SVG `<image>` (or an interactive `<g>` wrapping
 * one). `preserveAspectRatio="none"` is deliberate (plan §7): the layer's
 * recorded width/height already encode the correct aspect ratio, so the image
 * fills the rect exactly with no extra letterboxing.
 *
 * Selection feedback + resize handles are drawn separately by `SelectionOverlay`
 * (Phase 05). The base image is treated as the non-interactive canvas background
 * (see note below); overlays are click-selectable and draggable.
 */
export function LayerImage({ layer, svgRef }: LayerImageProps) {
  // Always call the hook (Rules of Hooks); for the base layer the handlers are
  // simply never attached.
  const handlers = useCanvasPointer(layer, svgRef)

  if (!layer.visible) return null

  // The base image fills the viewBox and is placed at (0,0); it IS the canvas
  // background, so it is intentionally NON-interactive on the canvas — clicks on
  // empty areas fall through to the background <rect> (which clears the
  // selection). Overlays are the movable, selectable layers. The base can still
  // be selected via the layer list (Phase 06).
  if (layer.isBaseImage) {
    return (
      <image
        href={layer.previewUrl}
        x={layer.x}
        y={layer.y}
        width={layer.width}
        height={layer.height}
        opacity={layer.opacity}
        preserveAspectRatio="none"
        pointerEvents="none"
        data-layer-id={layer.id}
        data-role="base"
      />
    )
  }

  return (
    <g
      {...handlers}
      data-layer-id={layer.id}
      data-role="overlay"
      style={{ cursor: 'move' }}
    >
      <image
        href={layer.previewUrl}
        x={layer.x}
        y={layer.y}
        width={layer.width}
        height={layer.height}
        opacity={layer.opacity}
        preserveAspectRatio="none"
      />
    </g>
  )
}
