/**
 * Escape the five XML attribute special characters so a value is safe to embed
 * inside an XML/SVG attribute value (single- or double-quoted). Used for every
 * `data-filename` and defensively for each image `href` data URI.
 *
 * Order matters: `&` MUST be escaped first, otherwise the entity replacements
 * for the other characters would themselves get their `&` re-escaped (e.g. `<`
 * would become `&amp;lt;` instead of `&lt;`).
 *
 * Pure and synchronous — unit-tested directly with no DOM.
 */
export function xmlEscapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
