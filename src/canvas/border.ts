/**
 * Pure border geometry — the single source of truth for a layer's border, called
 * by BOTH the live canvas (`LayerImage`) and the exporter
 * (`buildSvgDocument`). The `layoutText` pattern: one pure module, two callers,
 * so editor and export can never drift.
 *
 * THE CORE INVARIANT: an SVG stroke straddles its path, so a border is drawn as
 * the padded box pushed OUTWARD by half the thickness. Given box `(x, y, W, H)`,
 * padding `p >= 0`, thickness `t > 0`:
 *
 *   path.x = x - p - t/2      path.width  = W + 2p + t
 *   path.y = y - p - t/2      path.height = H + 2p + t      stroke-width = t
 *
 * The left stroke band then occupies `[x - p - t, x - p]` — its inner edge sits
 * EXACTLY on the padded box edge, with ZERO shared area with the asset. So a
 * border never covers any part of the enclosed asset.
 *
 * A negative padding is the only way to break this, so it is clamped at two
 * seams: `normalizeBorder` (the store seam) and defensively inside `borderRect`
 * (so a hand-built fixture can't break it either). The guarantee is GEOMETRIC;
 * renderers still antialias a shared boundary at `p = 0`, which is unavoidable
 * for any flush border and is NOT an overlap.
 *
 * NO `vector-effect="non-scaling-stroke"`: unlike every piece of editor chrome,
 * this stroke is EXPORTED, so a screen-relative width would be meaningless in a
 * standalone file.
 */
import type { LayerBorder } from '../types/layer'
import { quantize } from './quantize'

/** Neutral light grey. The theme's `--border` (`#dfe3df`) is green-tinted AND a
 *  CSS var, so it is unusable as stored data (the export is standalone). */
export const DEFAULT_BORDER_COLOR = '#cccccc'
/** Per the requirement: literal, always one canvas unit (a hairline on very
 *  large canvases; the user raises it manually). */
export const DEFAULT_BORDER_WIDTH = 1
/** Flush by default — the border hugs the asset edge. */
export const DEFAULT_BORDER_PADDING = 0
/** Caps so a typo can't produce a border wider than any canvas. */
export const MAX_BORDER_WIDTH = 512
export const MAX_BORDER_PADDING = 4096

/** Structural box a border is computed from. `Layer` satisfies it, so tests can
 *  pass bare boxes. `border` may be absent or `null` (= no border). */
export interface BorderBox {
  x: number
  y: number
  width: number
  height: number
  border?: LayerBorder | null
}

/** A border rect ready to paint. Consumed as React camelCase props (canvas) and
 *  as hyphenated XML attributes (export) — same field names either way. */
export interface BorderRect {
  x: number
  y: number
  width: number
  height: number
  strokeWidth: number
  color: string
}

/** A fresh default border object per call (never a shared mutable reference). */
export function defaultBorder(): LayerBorder {
  return {
    color: DEFAULT_BORDER_COLOR,
    width: DEFAULT_BORDER_WIDTH,
    padding: DEFAULT_BORDER_PADDING,
  }
}

/**
 * Is `raw` a literal `#rrggbb` colour (the form stored data must take)? Local
 * rather than importing `parseHexColor` from `panels/` — a canvas-layer module
 * must not depend on the UI layer. The UI commits colours through `parseHexColor`
 * (which expands `#rgb` → `#rrggbb`), so by the time a colour reaches this seam
 * it is already six digits; a hand-passed `#rgb` or named colour falls back.
 */
function isHexColor(raw: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(raw.trim())
}

/**
 * The store seam's clamp. Floors `padding` at 0, floors `width` at 0 and caps it
 * at `MAX_BORDER_WIDTH`, snaps BOTH through the existing `quantize`, and falls
 * back to the default colour for anything that isn't a literal `#rrggbb`.
 *
 * Quantizing `width`/`padding` here is NOT cosmetic: with `x`/`y` on the 0.5
 * grid and `t`/`p` on the 0.5 grid, `x - p - t/2` is an exact multiple of 0.25,
 * so every emitted coordinate stringifies as a short decimal — no
 * `99.15000000000001` in the exported bytes.
 */
export function normalizeBorder(b: LayerBorder): LayerBorder {
  return {
    width: quantize(Math.min(MAX_BORDER_WIDTH, Math.max(0, b.width))),
    padding: quantize(Math.min(MAX_BORDER_PADDING, Math.max(0, b.padding))),
    color: isHexColor(b.color) ? b.color.trim().toLowerCase() : DEFAULT_BORDER_COLOR,
  }
}

/**
 * The border rect to paint, or `null` when there is no border or `width <= 0`
 * (so a zero-width border is consistently invisible in the editor AND absent
 * from the export). Re-clamps `padding` defensively so a hand-built fixture with
 * a negative padding can't break the never-covers invariant.
 *
 * Deliberately does NOT quantize its OUTPUTS: rounding the path rect could push
 * the inner edge inward and break the invariant. Inputs are already on the 0.5
 * grid (sizes via the store, `width`/`padding` via `normalizeBorder`), so the
 * outputs are short decimals already.
 */
export function borderRect(box: BorderBox): BorderRect | null {
  const border = box.border
  if (border == null || border.width <= 0) return null
  // Defensive clamp: a hand-built fixture could carry a negative padding.
  const p = Math.max(0, border.padding)
  const t = border.width
  const half = t / 2
  return {
    x: box.x - p - half,
    y: box.y - p - half,
    width: box.width + 2 * p + t,
    height: box.height + 2 * p + t,
    strokeWidth: t,
    color: border.color,
  }
}

/**
 * The box grown by `padding + thickness` (the border's OUTER edge), or the box
 * itself when there is no border. Used by `createFrameLayer` so a frame never
 * slices through a member's own border — it encloses each member's VISIBLE
 * bounds, not just its box.
 */
export function borderOuterRect(box: BorderBox): {
  x: number
  y: number
  width: number
  height: number
} {
  const border = box.border
  if (border == null || border.width <= 0) {
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }
  const grow = Math.max(0, border.padding) + border.width
  return {
    x: box.x - grow,
    y: box.y - grow,
    width: box.width + 2 * grow,
    height: box.height + 2 * grow,
  }
}

/** UI convenience: does this layer have a border configured? (A border with
 *  `width: 0` is still "configured" — invisible, but its controls stay open.) */
export function hasBorder(layer: { border?: LayerBorder | null }): boolean {
  return layer.border != null
}
