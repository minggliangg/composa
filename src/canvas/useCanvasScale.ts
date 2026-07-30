/**
 * The canvas→screen scale: how many screen pixels one canvas unit occupies.
 *
 * The editor `<svg>` has `width`/`height` attributes equal to the canvas dims
 * and is constrained by CSS `max-w-full`/`max-h-full`. Under
 * `preserveAspectRatio="xMidYMid meet"` the element box keeps the canvas's
 * aspect ratio, so the uniform content scale is
 *   s = min(rect.width / canvas.width, rect.height / canvas.height)
 * (in steady state both terms are equal; `min` just guards rounding). This lets
 * editor chrome (resize handles) be sized in SCREEN pixels by dividing a target
 * px by `s` to get the equivalent canvas-unit size.
 *
 * `computeCanvasScale` is extracted as pure math (unit-testable in jsdom); the
 * hook wires it to the live `<svg>` via `getBoundingClientRect` + a
 * `ResizeObserver` so it tracks panel/canvas changes.
 */
import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { CanvasConfig } from '../types/layer'

/**
 * Pure scale calculation. Returns 1 (identity) for degenerate inputs so callers
 * never divide by zero — the hook falls back to assuming 1:1 until measured.
 */
export function computeCanvasScale(
  rect: { width: number; height: number },
  canvas: { width: number; height: number },
): number {
  if (!rect.width || !rect.height || !canvas.width || !canvas.height) return 1
  const s = Math.min(rect.width / canvas.width, rect.height / canvas.height)
  return s > 0 && Number.isFinite(s) ? s : 1
}

/**
 * Subscribe to the live screen-px-per-canvas-unit scale of `svgRef`. Re-measures
 * on mount, whenever the canvas dims change, and whenever the `<svg>` element
 * resizes (panel layout). Returns 1 until first measured.
 *
 * `zoom` (the viewport user-multiplier) is a dependency because the viewport is
 * a CSS `transform: scale()` on an ancestor wrapper: a transform does NOT change
 * the element's border box, so it fires no `ResizeObserver` callback. Without
 * `zoom` in the deps the reported scale would go stale the moment you zoom, even
 * though `getBoundingClientRect()` (used here) already reflects the transform.
 * Pass the live `zoom` so the hook re-measures — and thus reports the EFFECTIVE
 * scale (fit × zoom) that handle sizing and the status readout want.
 */
export function useCanvasScale(
  svgRef: RefObject<SVGSVGElement | null>,
  canvas: CanvasConfig | null,
  zoom = 1,
): number {
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg || !canvas) return
    const measure = () => {
      const next = computeCanvasScale(svg.getBoundingClientRect(), canvas)
      setScale((prev) => (prev === next ? prev : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(svg)
    return () => ro.disconnect()
  }, [svgRef, canvas, zoom])

  return scale
}
