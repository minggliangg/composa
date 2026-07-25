/**
 * Selection helpers shared by every surface that mutates the selection set
 * (canvas pointer drag, layer-list clicks). Centralizing the modifier → mode
 * rule keeps canvas and list selection behaviour identical.
 */

export type SelectionMode = 'replace' | 'add' | 'toggle'

/**
 * Map a pointer / mouse event's modifier keys to a selection mode.
 *
 * Any of shift / meta (mac) / ctrl (win, linux) → `toggle`. Plain click →
 * `replace`. (`add` is reserved for future range-selection; nothing produces it
 * yet, but the store honours it.)
 */
export function selectionModeFromEvent(event: {
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
}): SelectionMode {
  return event.shiftKey || event.metaKey || event.ctrlKey ? 'toggle' : 'replace'
}

/**
 * The primary (anchor) selection id — the last layer added to the set. The
 * properties form edits this layer, and resize handles target it.
 */
export function primarySelectedId(ids: string[]): string | null {
  return ids.length === 0 ? null : ids[ids.length - 1]
}
