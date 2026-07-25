import { useRef } from 'react'
import { useCompositionStore } from '../state/compositionStore'
import { LayerImage } from './LayerImage'
import { SelectionOverlay } from './SelectionOverlay'

/**
 * The live composition canvas. Renders a single `<svg>` driven entirely by the
 * Zustand store: `viewBox` = the base image's natural pixel size (canvas dims),
 * a background rect fills the viewport, every layer paints in ascending
 * z-index order, and the `SelectionOverlay` (outline + resize handles) paints
 * last so it stays on top. `preserveAspectRatio="xMidYMid meet"` letterboxes
 * the canvas to fit the panel while preserving aspect ratio.
 *
 * Off-canvas behavior (plan §4, §7): editor coordinates are deliberately NOT
 * clamped, so a layer dragged partly off-canvas still hangs out beyond the
 * boundary. The editor `<svg>` uses `overflow="visible"` (and the wrapping
 * section does not clip) so that off-canvas content stays visible in the editor
 * — "more honest, shows what's hanging off". A dashed `<rect>` along the canvas
 * boundary marks the export-crop edge. At EXPORT time the SVG viewport clips
 * automatically (standard SVG behavior), and `buildSvgDocument` builds from
 * state so this boundary rect never reaches the exported file.
 *
 * Interaction (Phases 04/05):
 *   - The background `<rect>` clears the selection on pointerdown. Because the
 *     base image is non-interactive (`pointerEvents="none"`), clicks on empty
 *     canvas area fall through to this rect.
 *   - Overlay layers attach drag handlers (see `LayerImage` / `useCanvasPointer`).
 *   - The selected overlay shows a selection outline + 8 resize handles.
 *
 * The `<svg>` ref is created here and threaded into every layer + the overlay so
 * screen→canvas conversion can use the live CTM.
 */
export function CompositionCanvas() {
  const canvas = useCompositionStore((s) => s.canvas)
  const layers = useCompositionStore((s) => s.layers)
  const clearSelection = useCompositionStore((s) => s.clearSelection)
  const svgRef = useRef<SVGSVGElement>(null)

  if (!canvas) {
    return (
      <section
        aria-label="Composition canvas"
        className="flex min-h-60 min-w-0 flex-1 items-center justify-center overflow-visible rounded-md border border-dashed border-border-strong bg-bg p-4"
      >
        <div className="text-center text-sm text-fg-muted">
          <p className="font-medium text-fg-subtle">composition canvas (empty)</p>
          <p className="mt-1">upload a base image to begin</p>
        </div>
      </section>
    )
  }

  // Array order directly maps to SVG paint order after sorting by z-index.
  const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex)

  return (
    <section
      aria-label="Composition canvas"
      // `overflow-visible` + the svg's own `overflow="visible"` let a layer
      // dragged partly off-canvas render beyond the canvas boundary in the
      // editor (the root app shell still clips at the window).
      className="flex min-h-60 min-w-0 flex-1 items-center justify-center overflow-visible rounded-md border border-border bg-bg p-4 shadow-inner"
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${canvas.width} ${canvas.height}`}
        width={canvas.width}
        height={canvas.height}
        preserveAspectRatio="xMidYMid meet"
        // EDITOR-ONLY: show content drawn outside the viewBox (off-canvas
        // overlays). At export, buildSvgDocument emits a fresh <svg> whose
        // default overflow clips the viewport — that crop is intentional.
        overflow="visible"
        className="max-h-full max-w-full shadow-2xl"
        role="img"
        aria-label="Composition"
        // Prevent the browser's native touch scrolling/gestures from hijacking
        // pointer drags on the canvas (we handle pointer events ourselves).
        style={{ touchAction: 'none' }}
      >
        {/* Background sits behind every layer so transparent areas read as
            white. It also receives pointerdown on empty canvas area (the base
            image lets clicks pass through it) to clear the selection. */}
        <rect
          x={0}
          y={0}
          width={canvas.width}
          height={canvas.height}
          className="fill-white"
          onPointerDown={() => clearSelection()}
        />
        {sortedLayers.map((layer) => (
          <LayerImage key={layer.id} layer={layer} svgRef={svgRef} />
        ))}
        {/* Dashed export-crop boundary. EDITOR-ONLY: drawn on top of layer
            content (perimeter remains visible along uncovered edges) but below
            the selection overlay so handles stay topmost. pointerEvents="none"
            so clicks pass through to the background/layers beneath. Never
            exported — buildSvgDocument builds from state and omits it
            (asserted by the export unit tests). */}
        <rect
          x={0}
          y={0}
          width={canvas.width}
          height={canvas.height}
          fill="none"
          stroke="var(--border-strong)"
          strokeDasharray="6 4"
          // Constant screen-pixel stroke regardless of the viewBox scale, so the
          // boundary is equally visible on a 200px and a 12000px canvas.
          vectorEffect="non-scaling-stroke"
          strokeWidth={1.5}
          pointerEvents="none"
          data-editor-only="boundary"
          data-testid="canvas-boundary"
        />
        <SelectionOverlay svgRef={svgRef} />
      </svg>
    </section>
  )
}
