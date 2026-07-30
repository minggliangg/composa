/**
 * Pure text metrics + layout for text layers (Atkinson Hyperlegible Mono).
 *
 * The font is MONOSPACE, so the advance width is a fixed fraction of the em —
 * there is no DOM measurement and no async. Both the live canvas and the SVG
 * exporter compute IDENTICAL geometry from these pure functions, so the box a
 * text layer occupies can never drift between editor and export.
 *
 * Every dimension is snapped to `QUANTIZE_STEP` (the half-pixel grid). This is
 * mandatory, not cosmetic: `isLayerResized` compares a layer's rendered size to
 * its natural size with EXACT equality, on the assumption that natural dims are
 * on the grid. An unrounded `38.4` would quantize to `38.5`, leaving "Reset to
 * original size" permanently lit. Do NOT fix that by adding an epsilon there —
 * it would loosen the check for rasters too. Instead, measureText snaps here.
 *
 * Pure and DOM-free — table-tested directly.
 */
import { quantize, QUANTIZE_STEP } from '../canvas/quantize'
import type { CanvasConfig, TextContent } from '../types/layer'

/** The font-family name as declared by the fontsource variable package. */
export const TEXT_FONT_FAMILY = 'Atkinson Hyperlegible Mono Variable'

/**
 * Advance width ÷ em — how wide one glyph cell is, as a fraction of the font
 * size. Measured for a MONOSPACE face so every glyph shares it.
 *
 * PROVISIONAL VALUE: 0.6 (a typical monospace advance). fontTools is unavailable
 * in this environment and the value must be confirmed by a one-off browser
 * measurement — `ctx.measureText('M'.repeat(100)).width / (100 * fontSize)` —
 * and the runtime Playwright assertion should pin it. Risk if it's slightly off
 * is low: the box is drawn with `preserveAspectRatio="none"`, so a wrong ratio
 * stretches the text UNIFORMLY and IDENTICALLY in canvas and export — it only
 * affects how tightly the box hugs the glyphs, never their relative positions.
 *
 * MEASURED 0.625 in Chromium (advance ÷ em). Pinned by the ADVANCE_RATIO
 * Playwright assertion in tests/e2e/text.spec.ts.
 */
export const ADVANCE_RATIO = 0.625

/**
 * First-baseline offset within a line box, as a fraction of the font size (the y
 * of the first line's baseline, measured from the top of the natural box).
 * PROVISIONAL — paired with `LINE_HEIGHT_RATIO` so ascenders/descenders sit
 * within the measured box.
 */
export const ASCENT_RATIO = 0.9

/** Line box height as a multiple of the font size. */
export const LINE_HEIGHT_RATIO = 1.2

/** Spaces substituted for a tab (a tab has no defined monospace advance). */
const TAB_WIDTH = 4

export interface TextLine {
  /** The (normalized) line text. */
  text: string
  /** x of the line's anchor (depends on alignment + box width). */
  x: number
  /** y of the line's baseline. */
  y: number
}

/**
 * Normalize raw text for storage + identical canvas/export rendering:
 *   - `\r\n` and a lone `\r` -> `\n` (one line break),
 *   - tabs -> `TAB_WIDTH` spaces (no defined monospace advance; keeps metrics
 *     and render in lockstep),
 *   - strip XML-invalid C0 controls (`\x00`–`\x08`, `\x0B`, `\x0C`,
 *     `\x0E`–`\x1F`). `xmlEscapeAttr` does NOT handle these, and a single
 *     pasted control char yields an SVG browsers refuse to render.
 *
 * Applied on WRITE (in the store) so canvas and export always see the same text.
 */
export function normalizeTextContent(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' '.repeat(TAB_WIDTH))
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

/**
 * Measure a text layer's natural (unscaled) box in font-size units, snapped to
 * the half-pixel grid. Width = widest line × advance; height = line count × line
 * height. Empty content returns a one-cell minimum box (never 0, so the
 * scale-preserving update can't divide by zero).
 */
export function measureText(
  content: string,
  fontSize: number,
): { width: number; height: number } {
  const lines = normalizeTextContent(content).split('\n')
  const lineCount = lines.length
  const maxChars = Math.max(1, ...lines.map((l) => l.length))
  return {
    width: quantize(maxChars * fontSize * ADVANCE_RATIO, QUANTIZE_STEP),
    height: quantize(lineCount * fontSize * LINE_HEIGHT_RATIO, QUANTIZE_STEP),
  }
}

/** Map a text alignment to the SVG `text-anchor` value that pairs with it. */
export function textAlignAnchor(
  align: TextContent['align'],
): 'start' | 'middle' | 'end' {
  return align === 'left' ? 'start' : align === 'center' ? 'middle' : 'end'
}

/**
 * Lay out every line of a text layer in NATURAL-BOX coordinates (origin top-left,
 * before any layer scale). Returns explicit `x`/`y` per line (never `dy`) so a
 * fallback font can change glyph shapes but never reflow line positions.
 *
 *   - y: first baseline at `ASCENT_RATIO × fontSize`; each subsequent line steps
 *     by `fontSize × LINE_HEIGHT_RATIO`.
 *   - x: per alignment, anchored against the BOX width (the widest line) — so a
 *     shorter line centers / right-aligns relative to the block, and single-line
 *     text is identical under every alignment (the box hugs the line).
 */
export function layoutText(text: TextContent): TextLine[] {
  const normalized = normalizeTextContent(text.content)
  const lines = normalized.split('\n')
  const { fontSize, align } = text
  const lineH = fontSize * LINE_HEIGHT_RATIO
  const firstBaseline = fontSize * ASCENT_RATIO

  // Box width = the widest line, same formula measureText uses, so the anchor x
  // lines up with the drawn box edges.
  const maxChars = Math.max(1, ...lines.map((l) => l.length))
  const boxWidth = quantize(maxChars * fontSize * ADVANCE_RATIO, QUANTIZE_STEP)

  const anchorX =
    align === 'left' ? 0 : align === 'center' ? boxWidth / 2 : boxWidth

  return lines.map((line, i) => ({
    text: line,
    x: anchorX,
    y: firstBaseline + i * lineH,
  }))
}

/**
 * A legible default font size for a freshly added text layer, scaled to the
 * canvas so it's readable at 1:1 on a 512px or 4096px canvas alike:
 * `clamp(12, round(canvas.height / 24), 200)`.
 */
export function defaultTextFontSize(canvas: CanvasConfig): number {
  return Math.min(200, Math.max(12, Math.round(canvas.height / 24)))
}
