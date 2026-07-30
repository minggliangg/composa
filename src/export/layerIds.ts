/**
 * Pure id-assignment for the exported SVG: turn each layer's display label into
 * a valid, unique XML `id` (an NCName) that survives as the per-element identity
 * in the exported document.
 *
 * The exported layer's `id` is a SANITISED machine handle (NCName-safe, deduped
 * in z order); the lossless human record lives alongside it in `data-name`
 * (emitted by `buildSvgDocument`). A custom name wins as the source label,
 * otherwise the original filename (text layers add a first-line case upstream).
 *
 * Pure and deterministic: the same layer set always yields the same ids, so the
 * export stays byte-deterministic (no `layer.id` UUID ever leaks — ids derive
 * from the label and the sorted index only). DOM-free, jsdom-safe.
 */
import type { Layer } from '../types/layer'
import { layerDisplayLabel } from '../upload/filenameDisplay'

/** The source label an id is derived from — the SAME label the layer list shows
 *  (custom name → text first-line → original filename), so a layer's exported
 *  `id` and its display name always agree. */
export function idSourceLabel(layer: Layer): string {
  return layerDisplayLabel(layer)
}

/**
 * Fold a raw label into a valid XML NCName `[A-Za-z_][A-Za-z0-9._-]*`.
 *
 *   - Every maximal run of characters NOT in `[A-Za-z0-9._-]` (spaces,
 *     punctuation, non-ASCII) collapses to a single `-`.
 *   - Leading/trailing `-` (separator noise) are trimmed.
 *   - A first character that is not a letter or `_` (a digit, or a stray `.`)
 *     gets an `_` prefix — `2024 hero` -> `_2024-hero`. Without this the id is a
 *     malformed NCName and browsers refuse to render the document.
 *   - Returns `''` when the label folds to nothing; the caller maps that to a
 *     positional fallback (`layer-<index>`).
 */
export function sanitizeSvgId(raw: string): string {
  // Collapse every run of disallowed characters to a single `-`.
  const collapsed = raw.replace(/[^A-Za-z0-9._-]+/g, '-')
  // Trim separator noise from both ends.
  const trimmed = collapsed.replace(/^-+/, '').replace(/-+$/, '')
  if (trimmed === '') return ''
  // NCName must start with a letter or `_`. Prefix `_` for a leading digit or
  // stray `.` so the result is always a valid NCName.
  if (!/^[A-Za-z_]/.test(trimmed)) return `_${trimmed}`
  return trimmed
}

/**
 * Assign a unique, z-order-stable id to every layer, returning a map from
 * `layer.id` -> exported `id` attribute.
 *
 * Iterates layers in ASCENDING z-index order (paint order, base first). The
 * first occurrence of a sanitized id keeps it; later duplicates get `-2`,
 * `-3`, … (uniformly, so a later label that happens to equal an earlier
 * assigned `id-2` can't collide either). A sanitized id that matches the nested
 * SVG namespace pattern `L\d+__` (used by `namespaceSvgMarkup`) is escaped with
 * a leading `_` so a user-chosen name can never collide with a namespaced
 * inner-SVG identifier. An empty sanitized id falls back to `layer-<index>`.
 */
/** Key under which a layer's BORDER rect id is stored in the map. Collision-proof:
 *  `layer.id` is a UUID, so it can never contain `#`. */
export function borderIdKey(layerId: string): string {
  return `${layerId}#border`
}

export function assignLayerIds(layers: Layer[]): Map<string, string> {
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex)
  const used = new Set<string>()
  const out = new Map<string, string>()

  const claim = (candidate: string): string => {
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
    let n = 2
    while (used.has(`${candidate}-${n}`)) n += 1
    const final = `${candidate}-${n}`
    used.add(final)
    return final
  }

  sorted.forEach((layer, index) => {
    const sanitized = sanitizeSvgId(idSourceLabel(layer))
    let id = sanitized === '' ? `layer-${index}` : sanitized
    // Escape the nested-SVG namespace prefix pattern so a user name can't
    // masquerade as a namespaced inner id (e.g. `L1__g1`).
    if (/^L\d+__/.test(id)) id = `_${id}`
    const claimed = claim(id)
    out.set(layer.id, claimed)
    // Claim a BORDER id for EVERY layer, bordered or not, so toggling a border
    // never renumbers another element. Must go through claim(), NOT a bare
    // used.add(): a user can name a layer literally `foo-border`, and with a
    // bare add that layer and a bordered layer named `foo` would both own
    // `foo-border`.
    out.set(borderIdKey(layer.id), claim(`${claimed}-border`))
  })
  return out
}
