/**
 * Status footer — a thin live readout strip at the bottom of the editor that
 * makes composa feel like a real instrument (think Figma's bottom bar). Pure
 * presentation: it reads layer/selection/canvas/dirty state from the
 * composition store and the fitted scale + last-saved timestamp from the
 * parallel `uiState` store. It writes nothing.
 *
 * Three clusters, justified between:
 *   - LEFT  — save state: a status dot + label (Saved / Unsaved changes / Ready).
 *   - CENTER— composition scope: "N layers" and "M selected" when relevant.
 *   - RIGHT — figures in the mono face + tabular-nums: canvas W×H, fit zoom %,
 *             and a relative "saved Xs ago" that ticks once per second.
 *
 * The relative-time ticker is a 1s `setInterval` kept in local state so it only
 * re-renders THIS component (not the store subscribers). It's a deliberately
 * coarse grain: sub-second precision is noise here.
 *
 * No tests assert on this component; it is purely additive DOM and intersects
 * none of the existing e2e locators.
 */
import { useEffect, useState } from 'react'
import { useCompositionStore } from '../state/compositionStore'
import { useUiState } from '../state/uiState'

/** Format an epoch-ms timestamp as a short relative string. */
function relativeTime(from: number, now: number): string {
  const s = Math.max(0, Math.round((now - from) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return `${h}h ago`
}

/** Small dot used in the save-state cluster. Color comes from the caller. */
function Dot({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={'inline-block h-1.5 w-1.5 rounded-full ' + className}
    />
  )
}

/** Muted middle-dot separator between status segments. */
function Sep() {
  return <span className="text-fg-subtle/50">·</span>
}

export function StatusBar() {
  const layers = useCompositionStore((s) => s.layers)
  const selectedCount = useCompositionStore((s) => s.selectedLayerIds.length)
  const canvas = useCompositionStore((s) => s.canvas)
  const isDirty = useCompositionStore((s) => s.isDirty)
  const scale = useUiState((s) => s.scale)
  const lastSavedAt = useUiState((s) => s.lastSavedAt)

  // 1s ticker so "saved Xs ago" stays fresh. Only this component re-renders.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const hasBase = layers.some((l) => l.isBaseImage)
  const zoomPct = Math.round(scale * 100)

  // LEFT cluster: save state. Dots are neutral (green is reserved for
  // meaningful surfaces — Export + selection — not the save indicator).
  let saveLabel: string
  let saveDotClass: string
  if (!hasBase) {
    saveLabel = 'Ready'
    saveDotClass = 'bg-fg-subtle'
  } else if (isDirty) {
    saveLabel = 'Unsaved changes'
    saveDotClass = 'bg-warn'
  } else if (lastSavedAt !== null) {
    saveLabel = 'Saved'
    saveDotClass = 'bg-fg'
  } else {
    saveLabel = 'Up to date'
    saveDotClass = 'bg-fg'
  }

  return (
    <footer
      data-testid="status-bar"
      className="composa-fade-in flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface/80 px-4 py-1.5 text-[11px] text-fg-subtle backdrop-blur-md supports-[backdrop-filter]:bg-surface/70"
    >
      {/* LEFT — save state */}
      <div className="flex items-center gap-2">
        <Dot className={saveDotClass} />
        <span className="text-fg-muted">{saveLabel}</span>
      </div>

      {/* CENTER — composition scope */}
      <div className="flex items-center gap-2">
        <span>
          {layers.length === 0 ? 'No layers' : `${layers.length} layer${layers.length === 1 ? '' : 's'}`}
        </span>
        {selectedCount > 0 && (
          <>
            <Sep />
            <span>
              {selectedCount} selected
            </span>
          </>
        )}
      </div>

      {/* RIGHT — figures (mono + tabular-nums for stable alignment) */}
      <div className="flex items-center gap-2 font-mono tabular-nums">
        {canvas ? (
          <span>
            {canvas.width}×{canvas.height}
          </span>
        ) : (
          <span>—</span>
        )}
        <Sep />
        <span>{zoomPct}%</span>
        {lastSavedAt !== null && (
          <>
            <Sep />
            <span className="font-sans">saved {relativeTime(lastSavedAt, now)}</span>
          </>
        )}
      </div>
    </footer>
  )
}
