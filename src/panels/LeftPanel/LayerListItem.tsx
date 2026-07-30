/**
 * A single row in the layer list (Phase 06).
 *
 * Shows the layer's display name (the dedup'd label — collisions get `(n)`
 * suffixes; the stored `originalFilename` itself is never mutated), highlights
 * click-to-select, a delete button (routed through the shared ConfirmDialog
 * owned by the parent LayerList), and drag-to-reorder plus up/down buttons.
 *
 * The base image row is visually tagged "base", is NOT draggable, and its
 * delete/move controls are disabled — the base is pinned at z-index 0 and can
 * only be removed via the TopBar's reset/clear.
 */
import { useRef, useState } from 'react'
import type { DragEvent, MouseEvent } from 'react'
import type { Layer } from '../../types/layer'
import type { SelectionMode } from '../../state/selection'
import { selectionModeFromEvent } from '../../state/selection'

export interface LayerListItemProps {
  layer: Layer
  /** Display label (dedup'd: collisions get `(n)` suffixes; never the stored value exported). */
  displayFilename: string
  /** True when this row is the currently-selected layer. */
  selected: boolean
  /** 0-based position of this row in the DISPLAYED list (descending z-index). */
  listIndex: number
  /** Total layer count (for boundary checks on up/down). */
  listLength: number
  /** True if another row is currently being dragged over this one. */
  isDropTarget: boolean
  /** Click selects the layer; the mode (replace/toggle) comes from modifiers. */
  onSelect: (mode: SelectionMode) => void
  /** Commit an edited name (the store trims and maps '' → null). */
  onRename: (name: string) => void
  /** Request deletion (opens the shared confirm). Disabled for the base. */
  onRequestDelete: () => void
  /** Move one slot up in the displayed list (toward front / higher z-index). */
  onMoveUp: () => void
  /** Move one slot down in the displayed list (toward back / lower z-index). */
  onMoveDown: () => void
  /** HTML5 DnD: this row started being dragged. */
  onDragStart: (e: DragEvent<HTMLLIElement>) => void
  /** HTML5 DnD: a dragged row is over this row. */
  onDragOver: (e: DragEvent<HTMLLIElement>) => void
  /** HTML5 DnD: a dragged row was dropped on this row. */
  onDrop: (e: DragEvent<HTMLLIElement>) => void
  /** HTML5 DnD: this row is no longer being dragged / dragged left this row. */
  onDragLeave: () => void
}

export function LayerListItem({
  layer,
  displayFilename,
  selected,
  listIndex,
  listLength,
  isDropTarget,
  onSelect,
  onRename,
  onRequestDelete,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
}: LayerListItemProps) {
  const isBase = layer.isBaseImage
  // The base sits at the bottom of the displayed list (listLength - 1) and is
  // never movable. Overlays can move within slots 0..listLength-2.
  const canMoveUp = !isBase && listIndex > 0
  // The slot just above the base is listLength - 2; an overlay there can't move
  // further down without crossing the base.
  const canMoveDown = !isBase && listIndex < listLength - 2

  // Inline rename: double-click the label swaps it for an <input>. The input is
  // rendered ONLY while editing (the <li> has no tabIndex, so a persistent
  // input would add a tab stop to every row). Escape cancels; Enter / blur
  // commit. The parent <li> is draggable + click-selects, and Escape must not
  // reach global handlers, so every input event stops propagation; the input is
  // non-draggable so a click-drag to select text never starts a row drag.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Set when Escape dismisses the editor so the subsequent blur (fired as the
  // input loses focus) is treated as a CANCEL, not a commit.
  const skipBlurCommit = useRef(false)

  const startEdit = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setDraft(layer.name ?? layer.originalFilename)
    setEditing(true)
  }
  const commitName = () => {
    onRename(draft)
    setEditing(false)
  }
  const cancelEdit = () => {
    setEditing(false)
  }

  return (
    <li
      // The base is not draggable; overlays are.
      draggable={!isBase}
      onDragStart={isBase ? undefined : onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      onClick={(e) => onSelect(selectionModeFromEvent(e))}
      data-layer-id={layer.id}
      data-testid="layer-item"
      data-selected={selected ? 'true' : 'false'}
      className={[
        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors',
        // Selected reads as a calm neutral emphasis here — the canvas selection
        // OUTLINE carries the green "selected" meaning; the list row just needs
        // to read as distinct from its unselected neighbors.
        selected
          ? 'border-border-strong bg-raised-hover'
          : 'border-transparent bg-raised hover:bg-raised-hover',
        isDropTarget ? 'ring-2 ring-fg-muted/40' : '',
        isBase ? 'cursor-default' : 'cursor-pointer',
      ].join(' ')}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {editing ? (
          <input
            ref={inputRef}
            // Focus + select on mount so the user can type/replace immediately.
            autoFocus
            value={draft}
            // Non-draggable + swallow pointer/click so editing never starts a row
            // drag or a selection change.
            draggable={false}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            // Stop keydown so Escape never reaches global handlers and Enter /
            // Space never trigger the <li>'s selection/drag.
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                inputRef.current?.blur()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                skipBlurCommit.current = true
                inputRef.current?.blur()
              }
            }}
            // The single commit seam: Enter → blur → commit; a plain blur (click
            // away) also commits. Escape pre-sets the skip flag → blur cancels.
            onBlur={() => {
              if (skipBlurCommit.current) {
                skipBlurCommit.current = false
                cancelEdit()
              } else {
                commitName()
              }
            }}
            className="min-w-0 rounded border border-border-strong bg-surface px-1 py-0.5 text-sm font-medium text-fg focus:outline-none focus:ring-2 focus:ring-fg-muted/40"
            data-testid="layer-rename-input"
          />
        ) : (
          <span
            className="truncate font-medium text-fg"
            title={displayFilename}
            onDoubleClick={startEdit}
          >
            {displayFilename}
          </span>
        )}
        {isBase && (
          <span className="mt-0.5 w-fit rounded-sm border border-border bg-raised px-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
            base
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMoveUp()
          }}
          disabled={!canMoveUp}
          aria-label="Move layer up"
          className="rounded p-1 text-fg-subtle hover:bg-raised-hover hover:text-fg focus:outline-none focus:ring-2 focus:ring-fg-muted/40 disabled:cursor-not-allowed disabled:opacity-30"
          data-testid="layer-move-up"
        >
          {/* Up arrow */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 8.5L7 4.5L11 8.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMoveDown()
          }}
          disabled={!canMoveDown}
          aria-label="Move layer down"
          className="rounded p-1 text-fg-subtle hover:bg-raised-hover hover:text-fg focus:outline-none focus:ring-2 focus:ring-fg-muted/40 disabled:cursor-not-allowed disabled:opacity-30"
          data-testid="layer-move-down"
        >
          {/* Down arrow */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 5.5L7 9.5L11 5.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRequestDelete()
          }}
          disabled={isBase}
          aria-label={`Delete ${displayFilename}`}
          title={isBase ? 'Base can only be removed via Reset' : 'Delete layer'}
          className="rounded p-1 text-fg-subtle hover:bg-danger/20 hover:text-danger focus:outline-none focus:ring-2 focus:ring-fg-muted/40 disabled:cursor-not-allowed disabled:opacity-30"
          data-testid="layer-delete"
        >
          {/* Trash icon */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2.5 3.5H11.5M5.5 3.5V2.5C5.5 2.22386 5.72386 2 6 2H8C8.27614 2 8.5 2.22386 8.5 2.5V3.5M4 3.5L4.5 11.5C4.52197 11.7761 4.72386 12 5 12H9C9.27614 12 9.47803 11.7761 9.5 11.5L10 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </li>
  )
}
