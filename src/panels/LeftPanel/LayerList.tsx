/**
 * Layer list (Phase 06).
 *
 * Renders every layer in DESCENDING z-index order: the topmost layer (highest
 * z-index, paints on top) at the top of the list, the base image pinned at the
 * bottom. The store array is ASCENDING (base at index 0, overlays ascending),
 * so `listOrder` helpers flip between the two orderings — reordering calls hit
 * the store with correctly mapped indices, and the store renumbers densely
 * with the base pinned at z-index 0.
 *
 * Owns one shared `ConfirmDialog` for deletion (rather than one per row) so
 * there's a single focus-managed confirmation surface. Tracks the id of the
 * layer pending deletion in local state.
 */
import { useState } from 'react'
import type { DragEvent } from 'react'
import { useCompositionStore } from '../../state/compositionStore'
import { layerDisplayLabel, dedupeDisplayLabels } from '../../upload/filenameDisplay'
import { listIndexToStoreIndex } from './listOrder'
import { LayerListItem } from './LayerListItem'
import { ConfirmDialog } from '../../components/ConfirmDialog'

export function LayerList() {
  const layers = useCompositionStore((s) => s.layers)
  const selectedLayerIds = useCompositionStore((s) => s.selectedLayerIds)
  const selectLayer = useCompositionStore((s) => s.selectLayer)
  const renameLayer = useCompositionStore((s) => s.renameLayer)
  const deleteLayer = useCompositionStore((s) => s.deleteLayer)
  const reorderLayer = useCompositionStore((s) => s.reorderLayer)

  // Id of the layer awaiting delete confirmation. Null = dialog closed.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  // Displayed-list index of the row currently being dragged (for drop styling).
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)

  // Displayed descending: highest z-index first, base (z=0) last. The store
  // array is already ascending so reversing gives the display order. We DON'T
  // re-sort by zIndex here — the invariant is array-order == z-order (base at
  // 0), maintained by the store's reorderLayer.
  const displayLayers = [...layers].reverse()

  // Compute display labels over the DISPLAYED set: a custom name wins, else the
  // original filename; collisions get deterministic ` (n)` tokens (dot-aware
  // for filenames, whole-string for custom names). The stored `name` /
  // `originalFilename` (and thus export metadata) stay verbatim. Recomputed
  // every render so it tracks additions/deletions/reorders/renames.
  const displayNames = dedupeDisplayLabels(
    displayLayers.map((l) => ({
      label: layerDisplayLabel(l),
      isFilename: l.name === null,
    })),
  )

  const length = displayLayers.length
  const pendingDeleteLayer = pendingDeleteId
    ? layers.find((l) => l.id === pendingDeleteId)
    : null
  // The (deduped) display label of the layer pending deletion, for the confirm
  // copy. Found by id through the parallel displayLayers/displayNames arrays.
  const pendingDeleteLabel = (() => {
    if (!pendingDeleteLayer) return null
    const idx = displayLayers.findIndex((l) => l.id === pendingDeleteLayer.id)
    return idx >= 0 ? (displayNames[idx] ?? null) : null
  })()

  // Move a displayed row by one slot. Converts displayed indices to store
  // indices before calling reorderLayer.
  const moveByOne = (fromList: number, toList: number) => {
    if (toList < 0 || toList >= length) return
    const fromStore = listIndexToStoreIndex(fromList, length)
    const toStore = listIndexToStoreIndex(toList, length)
    reorderLayer(fromStore, toStore)
  }

  // --- HTML5 drag-and-drop handlers ---

  const onDragStart = (listIndex: number) => (e: DragEvent<HTMLLIElement>) => {
    setDraggingIndex(listIndex)
    // Firefox requires dataTransfer to be set for drag to start.
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(listIndex))
  }

  const onDragOver = (listIndex: number) => (e: DragEvent<HTMLLIElement>) => {
    // The base row (last displayed index) is never a valid drop target —
    // overlays cannot be reordered past it.
    if (listIndex === length - 1) return
    if (draggingIndex === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetIndex(listIndex)
  }

  const onDrop = (listIndex: number) => (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault()
    const fromList = draggingIndex
    setDraggingIndex(null)
    setDropTargetIndex(null)
    if (fromList === null) return
    // Don't allow dropping onto the base row.
    if (listIndex >= length - 1) return
    if (fromList === listIndex) return
    const fromStore = listIndexToStoreIndex(fromList, length)
    const toStore = listIndexToStoreIndex(listIndex, length)
    reorderLayer(fromStore, toStore)
  }

  const onDragLeave = () => {
    setDropTargetIndex(null)
  }

  const onDragEnd = () => {
    // Fired by the dragged source when the drag finishes (drop or cancel).
    setDraggingIndex(null)
    setDropTargetIndex(null)
  }

  const confirmDelete = () => {
    if (pendingDeleteId) {
      deleteLayer(pendingDeleteId)
    }
    setPendingDeleteId(null)
  }

  const cancelDelete = () => setPendingDeleteId(null)

  return (
    <div className="flex min-h-30 flex-1 flex-col gap-1 rounded-md border border-border bg-raised/50 p-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        Layers
      </h2>
      {length === 0 ? (
        <p className="px-1 py-2 text-sm text-fg-muted">no layers yet</p>
      ) : (
        <ul
          className="flex flex-col gap-0.5"
          onDragEnd={onDragEnd}
          data-testid="layer-list"
        >
          {displayLayers.map((layer, listIndex) => (
            <LayerListItem
              key={layer.id}
              layer={layer}
              displayFilename={displayNames[listIndex] ?? layer.originalFilename}
              selected={selectedLayerIds.includes(layer.id)}
              listIndex={listIndex}
              listLength={length}
              isDropTarget={dropTargetIndex === listIndex}
              onSelect={(mode) => selectLayer(layer.id, mode)}
              onRename={(name) => renameLayer(layer.id, name)}
              onRequestDelete={() => setPendingDeleteId(layer.id)}
              onMoveUp={() => moveByOne(listIndex, listIndex - 1)}
              onMoveDown={() => moveByOne(listIndex, listIndex + 1)}
              onDragStart={onDragStart(listIndex)}
              onDragOver={onDragOver(listIndex)}
              onDrop={onDrop(listIndex)}
              onDragLeave={onDragLeave}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete layer?"
        message={
          pendingDeleteLayer
            ? `"${pendingDeleteLabel ?? pendingDeleteLayer.originalFilename}" will be removed from the composition. This cannot be undone.`
            : 'This layer will be removed from the composition.'
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  )
}
