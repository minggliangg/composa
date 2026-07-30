/**
 * Text-layer styling controls (Step 8).
 *
 * Shown by `PropertiesForm` when the primary selected layer is a text layer.
 * Drives the store's `updateLayerText` action, which recomputes natural dims and
 * preserves the layer's scale — so every control here also resizes the box.
 *
 * Content editing coalesces into undo via the gesture helpers: focus begins a
 * gesture (capturing the scale once), each keystroke writes through while
 * history is PAUSED, blur commits. An 800ms idle commit splits a long writing
 * session into multiple undo steps (otherwise one entry per 50-history-limit
 * typing session would evict the user's whole undo stack). The other controls
 * are discrete, so each is its own undo step.
 *
 * Native textarea undo (Ctrl+Z) still works: TopBar's undo handler bails on
 * HTMLTextAreaElement, and a native undo mutates the value + fires `change`,
 * writing through as a fresh text edit (acceptable — documented in the plan).
 */
import { useEffect, useRef, useState } from 'react'
import type { Layer, TextContent } from '../../types/layer'
import type { TrackedComposition } from '../../state/compositionStore'
import { useCompositionStore } from '../../state/compositionStore'
import { beginGesture, commitGesture } from '../../state/useTemporalStore'
import { parseLayerNumber } from './transformValidation'
import {
  parseHexColor,
  clampFontSize,
  FONT_WEIGHTS,
} from './textValidation'

interface TextControlsProps {
  layer: Layer
}

export function TextControls({ layer }: TextControlsProps) {
  // Re-narrow for TypeScript (the parent gates on kind === 'text').
  if (layer.fullResBytesRef.kind !== 'text') return null
  const text = layer.fullResBytesRef.text

  const updateLayerText = useCompositionStore((s) => s.updateLayerText)

  // --- content (gesture-coalesced) -----------------------------------------
  const [contentDraft, setContentDraft] = useState(text.content)
  const contentFocused = useRef(false)
  const scaleRef = useRef(1)
  const gestureRef = useRef<TrackedComposition | null>(null)
  const idleTimer = useRef<number | null>(null)

  // Sync the draft from the store when not focused (e.g. undo, or a rename).
  useEffect(() => {
    if (!contentFocused.current) setContentDraft(text.content)
  }, [text.content])

  // Clear a pending idle timer on unmount so it can't fire after teardown.
  useEffect(
    () => () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    },
    [],
  )

  const armIdleCommit = () => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current)
    // After 800ms of inactivity, checkpoint the gesture: commit what we have and
    // begin a fresh one, so a long session is several undo steps, not one giant.
    idleTimer.current = window.setTimeout(() => {
      if (gestureRef.current) {
        commitGesture(gestureRef.current)
        gestureRef.current = beginGesture()
      }
    }, 800)
  }

  const onContentFocus = () => {
    contentFocused.current = true
    // Capture the scale ONCE when editing begins (not per keystroke — that would
    // re-derive from an already-rounded width and accumulate drift).
    scaleRef.current =
      layer.naturalWidth > 0 ? layer.width / layer.naturalWidth : 1
    gestureRef.current = beginGesture()
  }

  const onContentChange = (value: string) => {
    setContentDraft(value)
    updateLayerText(layer.id, { content: value }, scaleRef.current)
    armIdleCommit()
  }

  const onContentBlur = () => {
    contentFocused.current = false
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current)
      idleTimer.current = null
    }
    if (gestureRef.current) {
      commitGesture(gestureRef.current)
      gestureRef.current = null
    }
  }

  // --- font size (discrete) -------------------------------------------------
  const [fontSizeDraft, setFontSizeDraft] = useState(String(text.fontSize))
  useEffect(() => {
    setFontSizeDraft(String(text.fontSize))
  }, [text.fontSize])
  const commitFontSize = (raw: string) => {
    const parsed = parseLayerNumber(raw)
    if (parsed === null) return
    updateLayerText(layer.id, { fontSize: clampFontSize(parsed) })
  }

  // --- fill colour (color input + hex text field) ---------------------------
  const [hexDraft, setHexDraft] = useState(text.fill)
  useEffect(() => {
    setHexDraft(text.fill)
  }, [text.fill])
  const commitHex = (raw: string) => {
    const parsed = parseHexColor(raw)
    if (parsed) updateLayerText(layer.id, { fill: parsed })
    else setHexDraft(text.fill) // revert invalid input on blur
  }

  const setAlign = (align: TextContent['align']) =>
    updateLayerText(layer.id, { align })

  const inputClass =
    'rounded-md border border-border bg-raised px-2 py-1 text-fg focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-fg-muted/40'

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Text
      </legend>

      <label className="flex flex-col gap-1" data-testid="properties-field-text-content">
        <span className="text-xs text-fg-muted">Content</span>
        <textarea
          value={contentDraft}
          onChange={(e) => onContentChange(e.target.value)}
          onFocus={onContentFocus}
          onBlur={onContentBlur}
          rows={3}
          className={`${inputClass} resize-y font-mono text-xs leading-relaxed`}
          data-testid="properties-text-content"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1" data-testid="properties-field-font-size">
          <span className="text-xs text-fg-muted">Font size</span>
          <input
            type="number"
            min={1}
            value={fontSizeDraft}
            onChange={(e) => {
              setFontSizeDraft(e.target.value)
              commitFontSize(e.target.value)
            }}
            onBlur={() => setFontSizeDraft(String(text.fontSize))}
            className={`${inputClass} font-mono tabular-nums`}
            data-testid="properties-font-size"
          />
        </label>

        <label className="flex flex-col gap-1" data-testid="properties-field-font-weight">
          <span className="text-xs text-fg-muted">Weight</span>
          <select
            value={text.fontWeight}
            onChange={(e) =>
              updateLayerText(layer.id, { fontWeight: Number(e.target.value) })
            }
            className={inputClass}
            data-testid="properties-font-weight"
          >
            {FONT_WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => updateLayerText(layer.id, { italic: !text.italic })}
          aria-pressed={text.italic}
          title="Italic"
          className={
            'rounded-md border px-2.5 py-1 text-xs font-medium uppercase transition-colors focus:outline-none focus:ring-2 focus:ring-fg-muted/40 ' +
            (text.italic
              ? 'border-primary bg-primary/15 text-accent'
              : 'border-border bg-raised text-fg-muted hover:bg-raised-hover')
          }
          data-testid="properties-italic"
        >
          Italic
        </button>

        <div
          className="flex overflow-hidden rounded-md border border-border"
          role="group"
          aria-label="Text alignment"
          data-testid="properties-align-group"
        >
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAlign(a)}
              aria-pressed={text.align === a}
              title={`Align ${a}${
                a !== 'left' ? ' (no effect on single-line text)' : ''
              }`}
              className={
                'px-2.5 py-1 text-xs font-medium capitalize transition-colors focus:outline-none focus:ring-2 focus:ring-fg-muted/40 ' +
                (text.align === a
                  ? 'bg-primary/15 text-accent'
                  : 'bg-raised text-fg-muted hover:bg-raised-hover')
              }
              data-testid={`properties-align-${a}`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2" data-testid="properties-field-fill">
        <span className="text-xs text-fg-muted">Fill</span>
        <input
          type="color"
          value={text.fill}
          onChange={(e) => updateLayerText(layer.id, { fill: e.target.value })}
          className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent"
          aria-label="Fill colour"
          data-testid="properties-fill-color"
        />
        <input
          type="text"
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={() => commitHex(hexDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className={`${inputClass} w-24 font-mono text-xs`}
          aria-label="Fill colour hex"
          data-testid="properties-fill-hex"
        />
      </label>
    </fieldset>
  )
}
