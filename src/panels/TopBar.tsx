/**
 * Top bar (Phase 06, Export wired in Phase 08, edge-case hardening in Phase 09,
 * undo/redo in the history phase).
 *
 * App name + composition-level controls:
 *   - **Undo / Redo**: ⌘Z / ⌘⇧Z (or ⌘Y) globally, plus two buttons. Disabled
 *     when there is nothing to undo/redo. Reads history depth reactively from
 *     the temporal store. The keyboard handler ignores keystrokes while a text
 *     /number input is focused so typing in the properties form isn't
 *     intercepted. History tracks only { canvas, layers }; selection and the
 *     dirty flag are untouched by undo.
 *   - **Export**: resolves every layer's full-resolution data URI through the
 *     WASM worker, builds a self-contained SVG from state, and downloads it.
 *     Disabled when there is no base image or while an export is in flight.
 *     Failures surface as a small inline error message.
 *   - **Reset / Clear**: opens the shared ConfirmDialog; on confirm calls
 *     `resetComposition()`. Disabled when there is nothing to reset. Reset also
 *     wipes history — it is a one-way trip, not an undo target.
 *   - **isDirty**: conveyed by the trailing period of the "composa." wordmark.
 *     Clean = a quiet slate dot; dirty = an amber dot with a gentle pulse. A
 *     custom hover/focus tooltip explains the current state, and a
 *     `beforeunload` guard asks the browser to confirm before navigating away
 *     whenever work is unsaved. A successful Export calls `markClean()` so the
 *     dot can return to its quiet state — that is the "save" loop until real
 *     persistence lands.
 *
 * Persistence model (MVP): there is NONE. Refreshing or closing the tab loses
 * the composition. The native `beforeunload` dialog TEXT is browser-controlled
 * and cannot be customized — we can only trigger it; the tooltip sets
 * expectations, the dialog is generic.
 */
import { useEffect, useState } from 'react'
import { useCompositionStore } from '../state/compositionStore'
import { useTemporalStore, undo, redo } from '../state/useTemporalStore'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { exportComposition } from '../export/exportComposition'
import { wasmErrorMessage } from '../upload/errorMessages'

export function TopBar() {
  const layers = useCompositionStore((s) => s.layers)
  const isDirty = useCompositionStore((s) => s.isDirty)
  const resetComposition = useCompositionStore((s) => s.resetComposition)
  const markClean = useCompositionStore((s) => s.markClean)

  // History depth drives the Undo/Redo disabled state. Subscribing to the
  // lengths (not the snapshots) keeps this cheap and re-renders only when the
  // history edges actually move.
  const canUndo = useTemporalStore((s) => s.pastStates.length > 0)
  const canRedo = useTemporalStore((s) => s.futureStates.length > 0)

  const [resetOpen, setResetOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const hasBase = layers.some((l) => l.isBaseImage)
  const hasLayers = layers.length > 0

  // Global undo/redo shortcuts. Ignore when focus is in an editable control so
  // typing in the properties form (or any input/textarea/contentEditable) isn't
  // hijacked, and so the browser's native text undo stays available there.
  // `metaKey` covers ⌘ on macOS; `ctrlKey` covers the Windows/Linux convention.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const target = e.target as HTMLElement | null
      const isEditable =
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      if (isEditable) return
      const key = e.key.toLowerCase()
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y'
      const isUndo = key === 'z' && !e.shiftKey
      if (!isUndo && !isRedo) return
      e.preventDefault()
      if (isUndo) undo()
      else redo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Ask the browser to confirm beforeunload whenever there is unsaved work.
  // `isDirty` is read fresh from the store INSIDE the handler (not captured in
  // the effect closure) so it always reflects the current state without needing
  // to re-subscribe on every dirty transition. The effect itself runs once and
  // cleans up its listener on unmount. Note: per the HTML spec the browser owns
  // the dialog's wording — setting returnValue/ preventDefault is all we control.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!useCompositionStore.getState().isDirty) return
      e.preventDefault()
      // `returnValue` is deprecated but is still the cross-browser trigger; some
      // engines require it in addition to preventDefault to show the prompt.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const handleExport = async () => {
    setExportError(null)
    setExporting(true)
    try {
      const result = await exportComposition()
      if (!result.ok) {
        // Map the WASM code to user copy when we have one; otherwise fall back
        // to stable reasons (`no_base` / `reencode_failed`).
        if (result.code) {
          setExportError(wasmErrorMessage(result.code))
        } else if (result.reason === 'no_base') {
          setExportError('Add a base image before exporting.')
        } else {
          setExportError('Could not export the composition.')
        }
      } else {
        // A clean export is the "save" moment for this MVP — settle the
        // save-status dot back to its quiet state.
        markClean()
      }
    } catch {
      setExportError('Could not export the composition.')
    } finally {
      setExporting(false)
    }
  }

  const confirmReset = () => {
    resetComposition()
    setResetOpen(false)
  }

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 shadow-sm">
      <div
        className="group relative flex w-max items-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-600"
        tabIndex={0}
        data-testid="save-status"
        role="img"
        aria-label={
          isDirty
            ? 'composa — unsaved changes. Export to keep your work.'
            : 'composa — up to date.'
        }
      >
        <span className="text-lg font-semibold tracking-tight text-white">
          composa
          <span
            aria-hidden="true"
            data-testid="save-status-dot"
            className={
              'inline-block transition-colors duration-300 ' +
              (isDirty ? 'text-amber-400 status-pulse' : 'text-slate-500')
            }
          >
            .
          </span>
        </span>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-50 mt-2 block w-max max-w-[15rem] rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 opacity-0 translate-y-0.5 transition duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus:opacity-100 group-focus:translate-y-0"
        >
          {isDirty
            ? 'Unsaved changes — Export to keep your work'
            : 'Up to date — Export to save an SVG'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Undo/Redo. Disabled at the history edges; tooltips explain when
            there's nothing to step to. Match the Reset button's border style so
            the history cluster reads as a calm secondary control group. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => undo()}
            disabled={!canUndo}
            title={canUndo ? 'Undo (⌘Z)' : 'Nothing to undo'}
            aria-label="Undo"
            className="rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600"
            data-testid="undo-button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 7h7.5a3.5 3.5 0 0 1 0 7H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5.5 4.5L3 7l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => redo()}
            disabled={!canRedo}
            title={canRedo ? 'Redo (⌘⇧Z)' : 'Nothing to redo'}
            aria-label="Redo"
            className="rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600"
            data-testid="redo-button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M13 7H5.5a3.5 3.5 0 0 0 0 7H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10.5 4.5L13 7l-2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={handleExport}
            disabled={!hasBase || exporting}
            title={exporting ? 'Exporting…' : 'Export composition as SVG'}
            aria-label="Export SVG"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none"
            data-testid="export-button"
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
          {exportError && (
            <span
              className="max-w-[16rem] text-[11px] text-red-300"
              data-testid="export-error"
            >
              {exportError}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setResetOpen(true)}
          disabled={!hasLayers}
          title="Clear the composition"
          aria-label="Reset composition"
          className="rounded-md border border-red-900 bg-red-950/60 px-3 py-1.5 text-sm font-medium text-red-200 transition-colors hover:bg-red-900/70 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-600"
          data-testid="reset-button"
        >
          Reset
        </button>
      </div>

      <ConfirmDialog
        open={resetOpen}
        title="Clear composition?"
        message="All layers will be removed and the canvas reset to empty. This cannot be undone."
        confirmLabel="Clear"
        cancelLabel="Cancel"
        destructive
        onConfirm={confirmReset}
        onCancel={() => setResetOpen(false)}
      />
    </header>
  )
}
