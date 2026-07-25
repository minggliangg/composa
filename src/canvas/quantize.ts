/**
 * Snap a canvas-unit transform value to a fixed grid step.
 *
 * Drag/resize math produces long-decimal floats (inverse-CTM conversion in
 * `coords.ts`, aspect-ratio division in `resize.ts`, placement math in
 * `UploadDropzone`). The store rounds every stored `x`/`y`/`width`/`height`
 * through `quantize` so all transform values land on the half-pixel grid
 * regardless of how they were produced (drag, resize, or typed input).
 *
 * `Math.round(value / step) * step` with `step = 0.5` yields exact IEEE-754
 * halves and integers (both representable), so no floating-point noise is
 * introduced. Extracted as a pure module so the rounding rule is unit-testable
 * and reusable without any React/store machinery.
 */

/** The grid every transform value snaps to, in canvas units. */
export const QUANTIZE_STEP = 0.5

/**
 * Round `value` to the nearest multiple of `step` (default the half-pixel
 * grid). Negative values round symmetrically (`-12.7` -> `-12.5`).
 */
export function quantize(value: number, step = QUANTIZE_STEP): number {
  return Math.round(value / step) * step
}

/**
 * Round only the transform fields present in a partial patch, returning a new
 * patch object. Fields absent from the input are absent from the output so the
 * store's shallow merge leaves them untouched.
 */
export function quantizePatch(
  patch: Partial<Pick<import('../types/layer').Layer, 'x' | 'y' | 'width' | 'height'>>,
): Partial<Pick<import('../types/layer').Layer, 'x' | 'y' | 'width' | 'height'>> {
  const out: Record<string, number> = {}
  if (patch.x !== undefined) out.x = quantize(patch.x)
  if (patch.y !== undefined) out.y = quantize(patch.y)
  if (patch.width !== undefined) out.width = quantize(patch.width)
  if (patch.height !== undefined) out.height = quantize(patch.height)
  return out
}
