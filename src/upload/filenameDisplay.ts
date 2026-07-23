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
