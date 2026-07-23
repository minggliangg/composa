/**
 * Shared confirmation modal (Phase 06). Backs every destructive action —
 * layer delete and composition reset/clear — so there is one consistent,
 * accessible confirmation surface.
 *
 * Accessibility:
 *   - On open, focus moves to the appropriate button (cancel by default, which
 *     is the safe non-destructive choice; confirm when explicitly requested).
 *   - Escape cancels.
 *   - Clicking the backdrop cancels.
 *   - Tab is trapped within the dialog while open (cycles through the two
 *     buttons) so focus can't leak to the editor behind it.
 *
 * Rendered in place (no portal) — the fixed-position backdrop + high z-index
 * cover the app regardless of where in the tree this mounts.
 */
import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  /** Label for the confirm button. */
  confirmLabel?: string
  /** Label for the cancel button. */
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  /**
   * Destructive dialogs focus the CANCEL button on open (safe default) and
   * style the confirm button red. Non-destructive dialogs focus confirm.
   */
  destructive?: boolean
}

const TABBABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  destructive = true,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus the appropriate button when the dialog opens. Re-runs only on
  // `open`/`destructive` transitions, not every render.
  useEffect(() => {
    if (!open) return
    const node = destructive ? cancelRef.current : confirmRef.current
    node?.focus()
  }, [open, destructive])

  // Escape cancels. Attached to the dialog container so it only fires while
  // the dialog is mounted/visible.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
      return
    }
    // Trap Tab within the dialog: when focus reaches the last (or first)
    // tabbable element, wrap around to the other end.
    if (e.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const tabbables = Array.from(
      root.querySelectorAll<HTMLElement>(TABBABLE),
    )
    if (tabbables.length === 0) return
    const first = tabbables[0]
    const last = tabbables[tabbables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  if (!open) return null

  // Backdrop click cancels only when the click lands on the backdrop itself
  // (not its children) — checking `target === currentTarget` ensures inner
  // clicks don't dismiss.
  return (
    <div
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      data-testid="confirm-dialog-backdrop"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onKeyDown={onKeyDown}
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        data-testid="confirm-dialog"
      >
        <h2
          id="confirm-dialog-title"
          className="text-base font-semibold text-slate-100"
        >
          {title}
        </h2>
        <p
          id="confirm-dialog-message"
          className="text-sm text-slate-400"
        >
          {message}
        </p>
        <div className="mt-1 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            data-testid="confirm-cancel"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={
              destructive
                ? 'rounded-md border border-red-600 bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400'
                : 'rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400'
            }
            data-testid="confirm-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
