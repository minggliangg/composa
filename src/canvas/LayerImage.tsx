import type { RefObject } from 'react'
import type { Layer } from '../types/layer'
import { useCanvasPointer } from './useCanvasPointer'
import { layoutText, textAlignAnchor, TEXT_FONT_FAMILY } from '../text/textMetrics'
import { borderRect } from './border'
import { useUiState } from '../state/uiState'

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
  // Canvas-unit-per-screen-px, for a frame's screen-relative hit-stroke. Only a
  // rect (frame) layer reads it, but the hook must run unconditionally.
  const scale = useUiState((s) => s.scale)

  if (!layer.visible) return null

  // A text layer: a nested <svg> laid out from the SAME pure layoutText the
  // exporter uses, so editor and export can't drift. Placed before the base
  // check — a text layer can't be a base today, but this ordering means a text
  // layer could never accidentally render as <image href=""> if that changes.
  // The transparent <rect> exists purely for hit-testing: a bare <text> only
  // responds to clicks on the glyphs themselves, so without it the layer would
  // be unselectable in empty parts of its box. pointer-events="all" (not a
  // transparent fill) states the intent and is immune to future opacity tweaks.
  // It is editor-only and can't leak into the export (the builder assembles from
  // state, not the DOM).
  if (layer.fullResBytesRef.kind === 'text') {
    const text = layer.fullResBytesRef.text
    const lines = layoutText(text)
    const anchor = textAlignAnchor(text.align)
    return (
      <g
        {...handlers}
        data-layer-id={layer.id}
        data-role="overlay"
        style={{ cursor: 'move' }}
      >
        <svg
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          viewBox={`0 0 ${layer.naturalWidth} ${layer.naturalHeight}`}
          preserveAspectRatio="none"
          opacity={layer.opacity}
        >
          <rect width="100%" height="100%" fill="none" pointerEvents="all" />
          <text
            fontFamily={`'${TEXT_FONT_FAMILY}', ui-monospace, monospace`}
            fontSize={text.fontSize}
            fontWeight={text.fontWeight}
            fontStyle={text.italic ? 'italic' : 'normal'}
            fill={text.fill}
            textAnchor={anchor}
          >
            {lines.map((l, i) => (
              <tspan key={i} x={l.x} y={l.y}>
                {l.text}
              </tspan>
            ))}
          </text>
        </svg>
        <LayerBorder layer={layer} />
      </g>
    )
  }

  // A rect layer (today only a Frame selection): an interactive overlay <g>
  // wrapping the real <rect>. Placed before the base check for the same reason
  // as the text arm (a rect is never a base, but this keeps it from ever
  // rendering as <image href="">). A transparent frame lets clicks fall THROUGH
  // to framed assets (`pointerEvents="none"` on the fill rect), so it doesn't
  // trap every interior click; an opaque rect legitimately owns its interior.
  // An editor-only transparent hit-stroke (the text layer's hit-rect pattern)
  // keeps the frame grabbable even when transparent.
  if (layer.fullResBytesRef.kind === 'rect') {
    const source = layer.fullResBytesRef
    const fill = source.fill
    const r = borderRect(layer)
    return (
      <g
        {...handlers}
        data-layer-id={layer.id}
        data-role="overlay"
        style={{ cursor: 'move' }}
      >
        <rect
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          fill={fill ?? 'none'}
          opacity={layer.opacity}
          pointerEvents={fill === null ? 'none' : 'all'}
        />
        <LayerBorder layer={layer} />
        <rect
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(r?.strokeWidth ?? 0, 10 / scale)}
          pointerEvents="stroke"
          data-editor-only="frame-hit"
        />
      </g>
    )
  }

  // The base image fills the viewBox and is placed at (0,0); it IS the canvas
  // background, so it is intentionally NON-interactive on the canvas — clicks on
  // empty areas fall through to the background <rect> (which clears the
  // selection). Overlays are the movable, selectable layers. The base can still
  // be selected via the layer list (Phase 06).
  //
  // NO <LayerBorder> here: an outward border on the canvas-filling base would
  // land entirely outside the exported viewBox (clipped there) while the
  // editor's `overflow="visible"` canvas still drew it — editor/export drift.
  // The border controls are hidden for the base for the same reason.
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
      <LayerBorder layer={layer} />
    </g>
  )
}

/**
 * A layer's border, from the SAME `borderRect` the exporter uses. A SIBLING of
 * the leaf element inside the same overlay <g> — never a child of a nested
 * <svg>, whose viewBox is in natural units, not canvas units. `opacity` mirrors
 * the export; the stroke lies strictly outside the asset so there is no
 * double-blend.
 *
 * Carries NO data-layer-id: `controls.spec.ts` derives paint order from
 * `svg [data-layer-id]`, which must stay one element per layer.
 * `pointerEvents="none"` so it never intercepts a drag. NO `vectorEffect` — this
 * is exported geometry, not editor chrome.
 */
function LayerBorder({ layer }: { layer: Layer }) {
  const r = borderRect(layer)
  if (r === null) return null
  return (
    <rect
      x={r.x}
      y={r.y}
      width={r.width}
      height={r.height}
      fill="none"
      stroke={r.color}
      strokeWidth={r.strokeWidth}
      opacity={layer.opacity}
      pointerEvents="none"
      data-role="border"
    />
  )
}
