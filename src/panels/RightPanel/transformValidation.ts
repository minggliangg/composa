/**
 * Pure validation helpers for the PropertiesForm numeric inputs (Phase 06).
 *
 * Extracted from the component so the edge cases (empty string, NaN, width/height
 * clamping) are unit-testable without rendering any React. The PropertiesForm
 * commits values through the SAME `updateLayerTransform` action canvas drag and
 * resize use, so these helpers are the only thing standing between raw text and
 * the store — they must never let NaN or a sub-floor size through.
 */
import type { Layer } from '../../types/layer'

/** Relative tolerance for treating a layer's current ratio as matching its
 *  natural aspect. Pixel-level drift from the half-pixel grid (e.g. width 200.5
 *  vs natural 200) shouldn't keep the "Reset aspect" button lit forever. */
export const ASPECT_EPSILON = 0.001

/**
 * Has a layer's rendered aspect ratio drifted from its source? Drag-resize
 * already preserves ratio (corner handles derive height from the natural
 * aspect), so distortion is only reachable through the numeric W/H fields.
 * The reset button stays inert when the layer is already at its natural ratio.
 */
export function isLayerDistorted(layer: Layer): boolean {
  if (layer.naturalWidth <= 0 || layer.naturalHeight <= 0) return false
  const naturalRatio = layer.naturalWidth / layer.naturalHeight
  const currentRatio = layer.width / layer.height
  return Math.abs(currentRatio - naturalRatio) > ASPECT_EPSILON
}

/**
 * Parse a raw text input into a finite number, returning `null` for empty or
 * non-numeric input. The caller treats `null` as "don't write anything" so a
 * transient empty field (while the user clears it to retype) never pollutes the
 * store with NaN.
 *
 * `Number('')` is `0` in JS, which is NOT what we want for an empty field, so
 * the empty-string check comes first. `Infinity`/`NaN` are rejected via
 * `Number.isFinite`.
 */
export function parseLayerNumber(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * Clamp a value to at least `min`. Used to floor `width`/`height` at
 * `MIN_LAYER_SIZE` on commit — negative or tiny dimensions would break the
 * resize math and render an invisible layer.
 *
 * `x`/`y` are intentionally NOT clamped: off-canvas positions are allowed
 * (plan §4) and handled by SVG viewport clipping at export time.
 */
export function clampTransformValue(value: number, min: number): number {
  return value < min ? min : value
}
