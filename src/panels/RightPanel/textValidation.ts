/**
 * Pure validation helpers for the text-layer styling controls (Step 8).
 *
 * Extracted so the edge cases (malformed hex, sub-floor font sizes) are unit-
 * testable without rendering React. The controls write through the store's
 * `updateLayerText` action, so these helpers are the only thing standing between
 * raw input and the stored `TextContent`.
 */

/**
 * Parse a hex colour (`#rgb` or `#rrggbb`, with or without the leading `#`,
 * any case) into a normalized `#rrggbb` lowercase string. Returns `null` for
 * anything that isn't a 3- or 6-digit hex colour.
 */
export function parseHexColor(raw: string): string | null {
  const m = raw.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (!m) return null
  const hex = m[1].toLowerCase()
  if (hex.length === 3) {
    return '#' + hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  }
  return '#' + hex
}

/** Minimum/maximum font size, in canvas units. */
export const MIN_FONT_SIZE = 1
export const MAX_FONT_SIZE = 4096

/**
 * Clamp a font size into the valid range. Negative or zero sizes would break
 * measureText (a zero height divides to nothing and collapses the box). NaN
 * (non-numeric input) falls back to the minimum; Infinity clamps to the max.
 */
export function clampFontSize(n: number): number {
  if (Number.isNaN(n)) return MIN_FONT_SIZE
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, n))
}

/** The variable-axis weights offered in the weight <select>, ascending. */
export const FONT_WEIGHTS = [200, 300, 400, 500, 600, 700, 800] as const
