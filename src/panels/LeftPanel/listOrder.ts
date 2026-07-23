/**
 * Pure helpers mapping between the two orderings of the layer array (Phase 06).
 *
 * The store's `layers` array is ASCENDING in z-index/paint order: the base image
 * sits at index 0, overlays follow in increasing z-index (plan §3/§4 — array
 * order directly IS SVG paint order).
 *
 * The layer list, by convention, displays DESCENDING: the topmost layer (highest
 * z-index, paints last/on top) appears at the TOP of the list, and the base
 * image sits at the BOTTOM. These helpers are the single place that flips
 * between the two orderings so reordering calls hit the store with correctly
 * mapped indices.
 */

/**
 * Convert a displayed-list index (0 = topmost, `length-1` = base at the bottom)
 * into the corresponding store-array index (0 = base, ascending).
 *
 *   displayed[0]            -> store[length - 1]   (topmost overlay)
 *   displayed[length - 1]   -> store[0]            (base image)
 */
export function listIndexToStoreIndex(
  listIndex: number,
  length: number,
): number {
  return length - 1 - listIndex
}

/**
 * Convert a store-array index (0 = base, ascending) into the displayed-list
 * index (0 = topmost, `length-1` = base at the bottom). Inverse of
 * `listIndexToStoreIndex`.
 */
export function storeIndexToListIndex(
  storeIndex: number,
  length: number,
): number {
  return length - 1 - storeIndex
}
