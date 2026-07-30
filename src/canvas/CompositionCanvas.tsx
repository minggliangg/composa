import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { useCompositionStore } from '../state/compositionStore'
import { useUiState } from '../state/uiState'
import type { ViewPoint } from './viewport'
import { LayerImage } from './LayerImage'
import { SelectionOverlay } from './SelectionOverlay'
import { SnapGuides } from './SnapGuides'
import { useCanvasScale } from './useCanvasScale'

/**
 * The live composition canvas. Renders a single `<svg>` driven entirely by the
 * Zustand store: `viewBox` = the base image's natural pixel size (canvas dims),
 * a background rect fills the viewport, every layer paints in ascending
 * z-index order, and the `SelectionOverlay` (outline + resize handles) paints
 * last so it stays on top. `preserveAspectRatio="xMidYMid meet"` letterboxes
 * the canvas to fit the panel while preserving aspect ratio.
 *
 * Viewport (Phase 4): a CSS `transform: translate(pan) scale(zoom)` with
 * `transform-origin: 50% 50%` is applied to the `<svg>` itself. `getScreenCTM()`
 * folds ancestor/element CSS transforms into the CTM, so `screenToCanvas`,
 * resize, and the pointer hooks need NO changes — drag + resize still land on
 * the correct canvas coordinates at any zoom (asserted by the zoom E2E). The
 * `<section>` is `overflow-hidden` so a zoomed/panned canvas clips at the panel
 * edge rather than painting over the side panels (a deliberate behavior change
 * from the prior `overflow-visible`).
 *
 * Off-canvas behavior (plan §4, §7): editor coordinates are deliberately NOT
 * clamped, so a layer dragged partly off-canvas still hangs out beyond the
 * boundary (now clipped at the panel edge). A dashed `<rect>` along the canvas
 * boundary marks the export-crop edge. At EXPORT time the SVG viewport clips
 * automatically, and `buildSvgDocument` builds from state so this boundary rect
 * never reaches the exported file.
 *
 * Interaction:
 *   - The background `<rect>` clears the selection on pointerdown (button 0,
 *     not while Space is held — that pans). Because the base image is
 *     non-interactive (`pointerEvents="none"`), clicks on empty canvas area fall
 *     through to this rect.
 *   - Overlay layers attach drag handlers (see `LayerImage` / `useCanvasPointer`),
 *     which bail when Space is held so a space-drag pans instead.
 *   - Ctrl/Cmd + wheel: cursor-anchored zoom (the canvas point under the cursor
 *     stays fixed). Plain wheel is left alone for normal page scrolling.
 *   - Middle-drag, or left-drag while Space is held: pan the viewport.
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
  const sectionRef = useRef<HTMLElement>(null)
  const setScale = useUiState((s) => s.setScale)

  // Viewport state + actions. `zoom` is passed to useCanvasScale so it
  // re-measures on zoom (a CSS transform fires no ResizeObserver).
  const zoom = useUiState((s) => s.zoom)
  const pan = useUiState((s) => s.pan)
  const zoomBy = useUiState((s) => s.zoomBy)
  const setPan = useUiState((s) => s.setPan)
  const resetView = useUiState((s) => s.resetView)
  const setSpaceHeld = useUiState((s) => s.setSpaceHeld)
  const spaceHeld = useUiState((s) => s.spaceHeld)

  // Measure the editor <svg>'s EFFECTIVE scale (screen-px per canvas unit,
  // already reflecting the zoom transform). Published into uiState so the status
  // footer + SelectionOverlay (handle sizing) track it without coupling.
  const scale = useCanvasScale(svgRef, canvas, zoom)
  useEffect(() => {
    setScale(scale)
  }, [scale, setScale])

  // A new base / blank size should land fit-to-panel, not at the prior zoom.
  // `canvas` identity changes on setBaseImage, so this refits on each new base.
  useEffect(() => {
    resetView()
  }, [canvas, resetView])

  // Ctrl/Cmd + wheel = cursor-anchored zoom. React's onWheel is passive, so
  // preventDefault there is ignored and the page scrolls — attach a non-passive
  // listener instead. Plain wheel is left untouched (normal scrolling).
  //
  // `canvas` is a dependency because the canvas `<section>` (which holds
  // `sectionRef`) only mounts once a base exists: without it the effect would
  // run once against a null ref and never re-attach when the canvas appears.
  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const rect = section.getBoundingClientRect()
      // Origin = wrapper (section) center = the svg's layout center (flexbox
      // centers it; symmetric padding keeps the centers aligned). The anchor is
      // the cursor measured relative to that origin.
      const center = {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      }
      const anchor: ViewPoint = { x: e.clientX - center.x, y: e.clientY - center.y }
      const factor = Math.exp(-e.deltaY * 0.002)
      zoomBy(factor, anchor)
    }
    section.addEventListener('wheel', onWheel, { passive: false })
    return () => section.removeEventListener('wheel', onWheel)
  }, [zoomBy, canvas])

  // Space-bar pan mode. Held → cursor `grab`; a left-drag pans instead of
  // dragging layers (useCanvasPointer bails while held). Same input-focus bail
  // TopBar's undo handler uses, and preventDefault so Space doesn't scroll or
  // re-trigger a focused button. `spaceHeldRef` gives handlers a synchronous
  // read; `spaceHeld` state re-renders for the cursor.
  const spaceHeldRef = useRef(false)
  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null
      return (
        !!el?.isContentEditable ||
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      )
    }
    const isSpace = (e: KeyboardEvent) => e.key === ' ' || e.code === 'Space'
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSpace(e)) return
      if (isEditable(e.target)) return
      e.preventDefault()
      spaceHeldRef.current = true
      setSpaceHeld(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isSpace(e)) return
      spaceHeldRef.current = false
      setSpaceHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [setSpaceHeld])

  // Pan gesture: middle-drag, or left-drag while Space is held.
  const panState = useRef<{
    pointerId: number
    startClient: ViewPoint
    startPan: ViewPoint
  } | null>(null)
  const [panning, setPanning] = useState(false)

  const onSectionPointerDown = (e: PointerEvent<HTMLElement>) => {
    const wantPan = e.button === 1 || (e.button === 0 && spaceHeldRef.current)
    if (!wantPan) return
    e.preventDefault()
    panState.current = {
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startPan: { ...pan },
    }
    setPanning(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onSectionPointerMove = (e: PointerEvent<HTMLElement>) => {
    const p = panState.current
    if (!p || p.pointerId !== e.pointerId) return
    setPan({
      x: p.startPan.x + (e.clientX - p.startClient.x),
      y: p.startPan.y + (e.clientY - p.startClient.y),
    })
  }
  const endPan = (e: PointerEvent<HTMLElement>) => {
    const p = panState.current
    if (!p || p.pointerId !== e.pointerId) return
    panState.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Capture may already be gone (pointercancel); the gesture is cleared.
    }
    setPanning(false)
  }

  const cursor = panning ? 'grabbing' : spaceHeld ? 'grab' : undefined

  if (!canvas) {
    return (
      <section
        aria-label="Composition canvas"
        className="flex min-h-60 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-dashed border-border-strong bg-bg p-4"
      >
        <div className="composa-fade-in flex flex-col items-center gap-3 text-center text-sm text-fg-muted">
          {/* Branded empty-state mark — a large faded frame + landscape glyph
              that reads as "an image goes here" and gives the empty canvas a
              deliberate, finished look rather than bare placeholder text. */}
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            aria-hidden="true"
            className="text-fg-subtle/40"
          >
            <rect
              x="6.75"
              y="9.75"
              width="34.5"
              height="28.5"
              rx="2.5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="16.5" cy="18.5" r="2.5" fill="currentColor" />
            <path
              d="M10 33l8.5-8.5 5 5L29 24l9 9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="font-medium text-fg-subtle">composition canvas (empty)</p>
          <p>upload a base image — or start from a blank canvas — to begin</p>
        </div>
      </section>
    )
  }

  // Array order directly maps to SVG paint order after sorting by z-index.
  const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex)

  return (
    <section
      ref={sectionRef}
      aria-label="Composition canvas"
      onPointerDown={onSectionPointerDown}
      onPointerMove={onSectionPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      style={cursor ? { cursor } : undefined}
      // `overflow-hidden`: a zoomed/panned canvas must clip at the panel edge
      // instead of painting over the side panels. (Previously overflow-visible.)
      className="flex min-h-60 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-border bg-bg p-4 shadow-inner"
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
        // The viewport transform. transform-origin 50% 50% = the svg's layout
        // center; getScreenCTM folds this transform in, so pointer math is
        // correct at any zoom without changes downstream.
        style={{
          touchAction: 'none',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '50% 50%',
        }}
      >
        {/* Background sits behind every layer so transparent areas read as
            white. It also receives pointerdown on empty canvas area (the base
            image lets clicks pass through it) to clear the selection — but not
            while panning (middle button / Space held). */}
        <rect
          x={0}
          y={0}
          width={canvas.width}
          height={canvas.height}
          className="fill-white"
          onPointerDown={(e) => {
            if (e.button === 0 && !spaceHeldRef.current) clearSelection()
          }}
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
        {/* Snap alignment guides for an in-progress drag. EDITOR-ONLY: drawn
            above layer content but below the selection overlay, and never
            exported (the builder emits from state, not the DOM). */}
        <SnapGuides />
        <SelectionOverlay svgRef={svgRef} />
      </svg>
    </section>
  )
}
