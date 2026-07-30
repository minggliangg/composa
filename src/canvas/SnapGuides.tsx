/**
 * Renders the active alignment guides for an in-progress snap drag.
 *
 * Reads `uiState.snapGuides` (published by `useCanvasPointer`) and draws one
 * `<line>` per guide, styled like the canvas boundary rect so the two read as
 * one system. These are EDITOR-ONLY chrome: they live inside the canvas `<svg>`
 * in canvas coordinates but never reach the export, because the builder
 * assembles from state rather than cloning the DOM.
 *
 * `vectorEffect="non-scaling-stroke"` keeps the guide equally visible at any
 * zoom; `pointerEvents="none"` lets clicks pass through to the layers beneath.
 */
import { useUiState } from '../state/uiState'

export function SnapGuides() {
  const guides = useUiState((s) => s.snapGuides)
  if (guides.length === 0) return null

  return (
    <g
      pointerEvents="none"
      data-editor-only="snap-guides"
      data-testid="snap-guides"
    >
      {guides.map((g, i) =>
        g.orientation === 'v' ? (
          // Vertical guide: a line at x = position, spanning y [start, end].
          <line
            key={`v${i}`}
            x1={g.position}
            y1={g.start}
            x2={g.position}
            y2={g.end}
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            data-testid="snap-guide"
          />
        ) : (
          // Horizontal guide: a line at y = position, spanning x [start, end].
          <line
            key={`h${i}`}
            x1={g.start}
            y1={g.position}
            x2={g.end}
            y2={g.position}
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
            data-testid="snap-guide"
          />
        ),
      )}
    </g>
  )
}
