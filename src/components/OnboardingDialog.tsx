/**
 * First-run onboarding walkthrough.
 *
 * A 4-step guided tour (Welcome → Compose → Arrange → Export) shown
 * automatically on the first visit (gated by `hasSeenOnboarding()` in
 * `App.tsx`) and re-openable any time via the TopBar help (?) icon.
 *
 * Accessibility & interaction model mirrors `ConfirmDialog.tsx`:
 *   - `role="dialog"` + `aria-modal="true"`, labelled/described by step content.
 *   - Escape closes. Backdrop click closes. Both settle the seen flag.
 *   - Tab is trapped within the dialog while open.
 *   - The primary button (Next / Got it) is focused when the dialog opens and
 *     whenever the step advances, so keyboard users always land on the forward
 *     action.
 *
 * The dialog reads its open/closed state from the `onboarding` store and writes
 * `markOnboardingSeen()` + `hideOnboarding()` on every dismiss path (finish,
 * Skip, ✕, Escape, backdrop) so the walkthrough never auto-pops again after a
 * user has interacted with it once. The TopBar help icon can still re-open it
 * because the *visibility* state is separate from the persisted *seen* flag.
 *
 * Rendered in place (no portal) — the fixed-position backdrop + z-50 cover the
 * app regardless of where in the tree this mounts, same approach as
 * ConfirmDialog.
 *
 * Icons are from @phosphor-icons/react (https://phosphoricons.com) — a clean,
 * consistent family — tinted with `currentColor` so they track the theme and
 * the tile's `text-primary` exactly like the rest of the UI.
 */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  StackIcon,
  FrameCornersIcon,
  SlidersIcon,
  ExportIcon,
  XIcon,
} from '@phosphor-icons/react'
import {
  useOnboardingOpen,
  hideOnboarding,
  markOnboardingSeen,
} from '../state/onboarding'

const TABBABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface Step {
  /** Short eyebrow label above the title. */
  kicker: string
  title: string
  body: string
  /** Phosphor icon component rendered at 40px, tinted with currentColor. */
  glyph: ReactNode
}

// A calm 4-beat tour: orient → make → refine → ship. Bodies stay tight so the
// card never grows past its max-width; each surfaces the specific affordance a
// first-timer needs to find next.
const STEPS: Step[] = [
  {
    kicker: 'Welcome',
    title: 'Compose images in your browser',
    body: 'Stack a base image with movable, resizable overlays and export the whole arrangement as one self-contained SVG. Nothing is uploaded — everything runs locally.',
    glyph: <StackIcon size={40} weight="duotone" aria-hidden />,
  },
  {
    kicker: 'Compose',
    title: 'Base first, then layer up',
    body: 'Upload a base image from the left panel — it sets the canvas size. Then add overlays, drag them around, and pull the corner/edge handles to resize.',
    glyph: <FrameCornersIcon size={40} weight="duotone" aria-hidden />,
  },
  {
    kicker: 'Arrange',
    title: 'Refine with pro-tool controls',
    body: 'Undo/redo with ⌘Z, align and distribute selections from the right panel, tune layer opacity, and flip the dark/light theme from the top bar.',
    glyph: <SlidersIcon size={40} weight="duotone" aria-hidden />,
  },
  {
    kicker: 'Export',
    title: 'Ship it as one SVG',
    body: 'Hit Export to download a single SVG with every image embedded at full resolution. Filenames, positions, and transparency are all preserved — open it in any browser.',
    glyph: <ExportIcon size={40} weight="duotone" aria-hidden />,
  },
]

export function OnboardingDialog() {
  const open = useOnboardingOpen()
  const [step, setStep] = useState(0)

  const dialogRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  const isLast = step === STEPS.length - 1

  // Any dismiss path settles the seen flag (so it never auto-pops again) and
  // closes the dialog. Centralised so finish / Skip / ✕ / Escape / backdrop all
  // share identical behaviour.
  const close = () => {
    markOnboardingSeen()
    hideOnboarding()
  }

  const goNext = () => {
    if (isLast) {
      close()
      return
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const goBack = () => setStep((s) => Math.max(s - 1, 0))

  // Reset to the first step whenever the dialog opens, so re-opening via the
  // help icon always starts the tour from the top. Also focus the forward
  // button on open.
  useEffect(() => {
    if (!open) return
    setStep(0)
    // Defer one tick so the button is mounted before we focus it.
    const id = window.requestAnimationFrame(() => nextRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [open])

  // Advance the focus to the (possibly relabelled) forward button on each step
  // change, so keyboard users always land on the primary action.
  useEffect(() => {
    if (!open) return
    nextRef.current?.focus()
  }, [step, open])

  // Escape closes. Backdrop click closes. Tab is trapped within the dialog.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
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

  const current = STEPS[step]

  return (
    <div
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/40 p-4 backdrop-blur-[2px]"
      data-testid="onboarding-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-body"
        onKeyDown={onKeyDown}
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-2xl [animation:composa-dialog-in_0.14s_ease-out]"
        data-testid="onboarding-dialog"
      >
        {/* Header: glyph + step content, with a close ✕ top-right. */}
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="mt-0.5 shrink-0 rounded-md bg-raised p-2 text-primary"
          >
            {current.glyph}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              {current.kicker}
            </p>
            <h2
              id="onboarding-title"
              className="mt-0.5 text-lg font-semibold text-fg"
            >
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close onboarding"
            title="Close"
            className="-mr-1 -mt-1 rounded-md border border-transparent bg-transparent p-1.5 text-fg-muted transition-colors hover:bg-raised-hover hover:text-fg focus:outline-none focus:ring-2 focus:ring-fg-muted/40"
            data-testid="onboarding-skip"
          >
            <XIcon size={16} weight="bold" aria-hidden />
          </button>
        </div>

        <p
          id="onboarding-body"
          className="text-sm leading-relaxed text-fg-muted"
        >
          {current.body}
        </p>

        {/* Progress dots — a calm 4-pip indicator of position in the tour. */}
        <div
          className="flex items-center gap-1.5"
          role="presentation"
          aria-hidden="true"
          data-testid="onboarding-dots"
        >
          {STEPS.map((s, i) => (
            <span
              key={s.kicker}
              className={
                'h-1.5 rounded-full transition-all duration-200 ' +
                (i === step
                  ? 'w-5 bg-primary'
                  : 'w-1.5 bg-border')
              }
            />
          ))}
          <span className="ml-2 text-[11px] tabular-nums text-fg-subtle">
            {step + 1} / {STEPS.length}
          </span>
        </div>

        {/* Footer: Back on the left; the forward action (Next / Got it) on the
            right. Mirrors the confirm/cancel rhythm of ConfirmDialog. */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="rounded-md border border-border bg-raised px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-raised-hover focus:outline-none focus:ring-2 focus:ring-fg-muted/40 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="onboarding-back"
          >
            Back
          </button>
          <button
            ref={nextRef}
            type="button"
            onClick={goNext}
            className="rounded-md border border-primary bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg shadow-sm transition-colors hover:bg-primary-strong focus:outline-none focus:ring-2 focus:ring-fg-muted/40"
            data-testid="onboarding-next"
          >
            {isLast ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
