import type { Layer } from '../types/layer'

/**
 * Compute display labels for a list of filenames, appending deterministic
 * `(n)` suffixes for collisions.
 *
 * The ORIGINAL filename in state is NEVER mutated — this only produces the
 * label shown in the layer list. Export still uses the verbatim
 * `originalFilename`.
 *
 * Rules (see MVP plan §7, "Duplicate filenames"):
 *   - The first occurrence of a name keeps it verbatim.
 *   - The 2nd occurrence of `foo.png` displays `foo (1).png`, the 3rd
 *     `foo (2).png`, etc. — the ` (n)` token is inserted BEFORE the file
 *     extension, where `n` is the occurrence index minus one.
 *   - The name is split into base + extension at the LAST `.`. A name with no
 *     `.` (or only a leading `.` like a dotfile) is treated as having no
 *     extension, so the suffix is appended to the whole string.
 *
 * Determinism: the suffix assigned to a given position depends only on how many
 * times that EXACT original name appeared earlier in the input array, so the
 * same layer set always produces the same labels regardless of re-renders.
 * (If an upload's original name already happens to look like a generated label,
 * e.g. a real file named `foo (1).png`, it is treated as its own distinct name
 * — we do not attempt to re-resolve accidental secondary collisions, which the
 * MVP spec does not require.)
 */

/**
 * Insert the ` (n)` suffix immediately before the file extension. With no
 * extension (no `.`, or only a leading dot), append it to the whole name.
 */
function insertSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  // dot <= 0 covers "no dot at all" (-1) and "leading-dot dotfile" (0), both of
  // which have no real extension to split before.
  if (dot <= 0) {
    return `${name} (${n})`
  }
  const base = name.slice(0, dot)
  const ext = name.slice(dot) // includes the leading "."
  return `${base} (${n})${ext}`
}

/**
 * Return display labels for `filenames`, in the same order, with collisions
 * disambiguated by `(n)` suffixes inserted before each extension. The input
 * array and the stored filenames it came from are never mutated.
 */
export function dedupeDisplayNames(filenames: string[]): string[] {
  const seenCount = new Map<string, number>()
  const labels: string[] = []
  for (const name of filenames) {
    const prior = seenCount.get(name) ?? 0
    seenCount.set(name, prior + 1)
    labels.push(prior === 0 ? name : insertSuffix(name, prior))
  }
  return labels
}

/**
 * The pre-dedup label a layer shows in the layer list (also the source string
 * for the exported id). Resolution order: custom `name` → text layer first
 * content line → `originalFilename`. This is DISPLAY ONLY; the stored values are
 * never mutated. `fullResBytesRef` is optional so non-layer inputs (tests) that
 * only carry `name`/`originalFilename` still work.
 */
export function layerDisplayLabel(
  layer: Pick<Layer, 'name' | 'originalFilename'> & {
    fullResBytesRef?: Layer['fullResBytesRef']
  },
): string {
  if (layer.name !== null) return layer.name
  // A text layer with no custom name shows its first content line.
  const ref = layer.fullResBytesRef
  if (ref?.kind === 'text') {
    const first = ref.text.content.split('\n')[0] ?? ''
    return first.trim() === '' ? 'Text' : first
  }
  return layer.originalFilename
}

/** One layer's pre-dedup label plus whether that label is a filename. */
export interface DisplayLabelEntry {
  label: string
  /** True when `label` came from `originalFilename` (dot-aware suffix on
   *  collision); false for custom names / text labels (append ` (n)` whole). */
  isFilename: boolean
}

/**
 * Disambiguate a list of display labels for collisions. Like
 * `dedupeDisplayNames`, the FIRST occurrence of a label keeps it verbatim and
 * later collisions get a ` (n)` token — but the token's placement depends on
 * the label's origin:
 *   - a FILENAME keeps the dot-aware `insertSuffix` (so `hero.png` → `hero (1).png`),
 *   - a non-filename (custom name / text label) appends ` (n)` to the whole
 *     string (so `v1.2 hero` → `v1.2 hero (1)`, never `v1.2 hero (1).2`-style
 *     mid-dot splits).
 *
 * Determinism: the suffix at a position depends only on prior EXACT-label
 * matches, so the same layer set always yields the same labels across renders.
 */
export function dedupeDisplayLabels(entries: DisplayLabelEntry[]): string[] {
  const seenCount = new Map<string, number>()
  const labels: string[] = []
  for (const { label, isFilename } of entries) {
    const prior = seenCount.get(label) ?? 0
    seenCount.set(label, prior + 1)
    if (prior === 0) {
      labels.push(label)
    } else if (isFilename) {
      labels.push(insertSuffix(label, prior))
    } else {
      labels.push(`${label} (${prior})`)
    }
  }
  return labels
}
