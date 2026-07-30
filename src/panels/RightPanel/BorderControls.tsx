/**
 * Per-layer border controls (Slice B).
 *
 * Shown by `PropertiesForm` for every non-base layer. The border model lives in
 * `canvas/border.ts`; every commit writes through the store's batched
 * `setLayersBorder` action, which normalizes (floors/caps/snaps) the values.
 *
 * Undo discipline: width/padding typing and the OS colour-picker drag are each
 * wrapped in a gesture (focus begins, blur commits) so a burst of writes
 * collapses to ONE undo step — without it, dragging the picker evicts the
 * user's real undo stack within `HISTORY_LIMIT = 50`. The hex field commits
 * once on blur (discrete), and the toggle is a single discrete action.
 *
 * A frame layer (`kind: 'rect'`) keeps its border locked on: removing it would
 * leave an invisible, confusing layer. Its colour/width/padding stay editable.
 */
import { useEffect, useRef, useState } from 'react'
import type { Layer } from '../../types/layer'
import type { TrackedComposition } from '../../state/compositionStore'
import { useCompositionStore } from '../../state/compositionStore'
import { beginGesture, commitGesture } from '../../state/useTemporalStore'
import { parseLayerNumber } from './transformValidation'
import { parseHexColor } from './textValidation'
import { defaultBorder, hasBorder } from '../../canvas/border'

interface BorderControlsProps {
  layer: Layer
}

export function BorderControls({ layer }: BorderControlsProps) {
  const setLayersBorder = useCompositionStore((s) => s.setLayersBorder)
  const on = hasBorder(layer)
  // When off, the inner controls are disabled, so `border` defaults (values are
  // never read interactively). When on, `layer.border` is defined.
  const border = layer.border ?? defaultBorder()
  // A frame layer is defined BY its border — the toggle stays locked on.
  const isFrame = layer.fullResBytesRef.kind === 'rect'

  // --- width (gesture-coalesced, writes through per keystroke) --------------
  const [widthDraft, setWidthDraft] = useState(String(border.width))
  const widthFocused = useRef(false)
  useEffect(() => {
    if (!widthFocused.current) setWidthDraft(String(border.width))
  }, [border.width])
  const commitWidth = (raw: string) => {
    const parsed = parseLayerNumber(raw)
    if (parsed === null) return
    setLayersBorder([layer.id], { ...border, width: parsed })
  }

  // --- padding (gesture-coalesced, writes through per keystroke) ------------
  const [paddingDraft, setPaddingDraft] = useState(String(border.padding))
  const paddingFocused = useRef(false)
  useEffect(() => {
    if (!paddingFocused.current) setPaddingDraft(String(border.padding))
  }, [border.padding])
  const commitPadding = (raw: string) => {
    const parsed = parseLayerNumber(raw)
    if (parsed === null) return
    setLayersBorder([layer.id], { ...border, padding: parsed })
  }

  // --- colour (picker + hex) ------------------------------------------------
  const [hexDraft, setHexDraft] = useState(border.color)
  const hexFocused = useRef(false)
  useEffect(() => {
    if (!hexFocused.current) setHexDraft(border.color)
  }, [border.color])
  const commitHex = (raw: string) => {
    const parsed = parseHexColor(raw)
    if (parsed) setLayersBorder([layer.id], { ...border, color: parsed })
    else setHexDraft(border.color) // revert invalid input on blur
  }

  // One coalesced gesture shared across the editable fields. Depth-counted in
  // useTemporalStore, so overlapping focus/blur across fields (and even a canvas
  // drag) still collapse correctly.
  const gestureRef = useRef<TrackedComposition | null>(null)
  const beginEdit = () => {
    if (!gestureRef.current) gestureRef.current = beginGesture()
  }
  const endEdit = () => {
    if (gestureRef.current) {
      commitGesture(gestureRef.current)
      gestureRef.current = null
    }
  }

  const toggle = () =>
    setLayersBorder([layer.id], on ? null : defaultBorder())

  const inputClass =
    'rounded-md border border-border bg-raised px-2 py-1 text-fg focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-fg-muted/40 disabled:cursor-not-allowed disabled:text-fg-subtle'

  return (
    <fieldset className="flex flex-col gap-2" data-testid="properties-border">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Border
      </legend>

      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        disabled={isFrame}
        title={isFrame ? 'A frame is defined by its border' : 'Toggle border'}
        className={
          'self-start rounded-md border px-2.5 py-1 text-xs font-medium uppercase transition-colors focus:outline-none focus:ring-2 focus:ring-fg-muted/40 disabled:cursor-not-allowed ' +
          (on
            ? 'border-primary bg-primary/15 text-accent'
            : 'border-border bg-raised text-fg-muted hover:bg-raised-hover')
        }
        data-testid="properties-border-toggle"
      >
        Border
      </button>

      <fieldset className="flex flex-col gap-2" disabled={!on}>
        <div className="grid grid-cols-2 gap-2">
          <label
            className="flex flex-col gap-1"
            data-testid="properties-field-border-width"
          >
            <span className="text-xs text-fg-muted">Width</span>
            <input
              type="number"
              step={0.5}
              min={0}
              value={widthDraft}
              onChange={(e) => {
                setWidthDraft(e.target.value)
                commitWidth(e.target.value)
              }}
              onFocus={() => {
                widthFocused.current = true
                beginEdit()
              }}
              onBlur={() => {
                widthFocused.current = false
                endEdit()
                setWidthDraft(String(border.width))
              }}
              className={`${inputClass} font-mono tabular-nums`}
              data-testid="properties-border-width"
            />
          </label>

          <label
            className="flex flex-col gap-1"
            data-testid="properties-field-border-padding"
          >
            <span className="text-xs text-fg-muted">Padding</span>
            <input
              type="number"
              step={0.5}
              min={0}
              value={paddingDraft}
              onChange={(e) => {
                setPaddingDraft(e.target.value)
                commitPadding(e.target.value)
              }}
              onFocus={() => {
                paddingFocused.current = true
                beginEdit()
              }}
              onBlur={() => {
                paddingFocused.current = false
                endEdit()
                setPaddingDraft(String(border.padding))
              }}
              className={`${inputClass} font-mono tabular-nums`}
              data-testid="properties-border-padding"
            />
          </label>
        </div>

        <label
          className="flex items-center gap-2"
          data-testid="properties-field-border-color"
        >
          <span className="text-xs text-fg-muted">Colour</span>
          <input
            type="color"
            value={border.color}
            onChange={(e) => setLayersBorder([layer.id], { ...border, color: e.target.value })}
            onFocus={beginEdit}
            onBlur={endEdit}
            className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent disabled:cursor-not-allowed"
            aria-label="Border colour"
            data-testid="properties-border-color"
          />
          <input
            type="text"
            value={hexDraft}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={() => commitHex(hexDraft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            onFocus={() => {
              hexFocused.current = true
            }}
            className={`${inputClass} w-24 font-mono text-xs`}
            aria-label="Border colour hex"
            data-testid="properties-border-hex"
          />
        </label>
      </fieldset>
    </fieldset>
  )
}
