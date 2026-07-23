/**
 * Top bar (Phase 06, Export wired in Phase 08, edge-case hardening in Phase 09).
 *
 * App name + composition-level controls:
 *   - **Export**: resolves every layer's full-resolution data URI through the
 *     WASM worker, builds a self-contained SVG from state, and downloads it.
 *     Disabled when there is no base image or while an export is in flight.
 *     Failures surface as a small inline error message.
 *   - **Reset / Clear**: opens the shared ConfirmDialog; on confirm calls
 *     `resetComposition()`. Disabled when there is nothing to reset.
 *   - **isDirty**: a subtle "unsaved changes" badge when the store is dirty,
 *     PLUS a persistent, honest banner (just under the header) and a
 *     `beforeunload` guard that both fire whenever work is unsaved.
 *
 * Persistence model (MVP): there is NONE. Refreshing or closing the tab loses
 * the composition. The banner says so in plain language, and the `beforeunload`
 * handler asks the browser to confirm before navigating away. Note: the native
 * `beforeunload` dialog TEXT is browser-controlled and cannot be customized —
 * we can only trigger it; the banner sets expectations, the dialog is generic.
 */
import { useEffect, useState } from 'react'
import { useCompositionStore } from '../state/compositionStore'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { exportComposition } from '../export/exportComposition'
import { wasmErrorMessage } from '../upload/errorMessages'

export function TopBar() {
  const layers = useCompositionStore((s) => s.layers)
  const isDirty = useCompositionStore((s) => s.isDirty)
  const resetComposition = useCompositionStore((s) => s.resetComposition)

  const [resetOpen, setResetOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const hasBase = layers.some((l) => l.isBaseImage)
  const hasLayers = layers.length > 0

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
    <>
    <header className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-4 py-3 text-slate-50">
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold tracking-tight">composa.</span>
        {isDirty && (
          <span
            className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-300"
            data-testid="dirty-badge"
          >
            unsaved changes
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-slate-400 sm:inline">
          refresh loses unsaved work
        </span>

        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={handleExport}
            disabled={!hasBase || exporting}
            title={exporting ? 'Exporting…' : 'Export composition as SVG'}
            aria-label="Export SVG"
            className="rounded-md border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
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
          className="rounded-md border border-red-800 bg-red-900/70 px-3 py-1.5 text-sm font-medium text-red-100 transition-colors hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-400"
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

      {isDirty && (
        <div
          role="status"
          aria-live="polite"
          data-testid="unsaved-banner"
          className="flex items-center gap-2 border-b border-amber-400/60 bg-amber-50 px-4 py-1.5 text-xs text-amber-900"
        >
          <span aria-hidden="true" className="text-sm leading-none">
            ⚠
          </span>
          <span>
            <strong className="font-semibold">Unsaved changes.</strong>{' '}
            Refreshing or closing this tab will lose your work — composa. does
            not save your composition. Use{' '}
            <strong className="font-semibold">Export</strong> to keep an SVG.
          </span>
        </div>
      )}
    </>
  )
}
