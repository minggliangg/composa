/**
 * Properties form (Phase 06).
 *
 * Reads `selectedLayerId` from the store; if none is selected (or the selected
 * id no longer resolves to a layer) shows a placeholder. Otherwise renders:
 *   - the layer's `originalFilename` read-only,
 *   - natural pixel dimensions read-only (context only),
 *   - numeric inputs for `x`, `y`, `width`, `height` that write through the
 *     SAME `updateLayerTransform` action canvas drag/resize use — so the form
 *     and the canvas can never drift.
 *
 * Input handling: each field keeps a local string draft so the user can clear
 * and retype without the field snapping back. Valid values commit immediately;
 * on blur, empty/invalid drafts revert to the store value and width/height are
 * clamped to `MIN_LAYER_SIZE`.
 */
import { useEffect, useRef, useState } from 'react'
import type { Layer } from '../../types/layer'
import { useCompositionStore } from '../../state/compositionStore'
import { MIN_LAYER_SIZE } from '../../canvas/resize'
import { clampTransformValue, parseLayerNumber } from './transformValidation'

type Field = 'x' | 'y' | 'width' | 'height'

/** Text + units for the transform fields, in the order they render. */
const FIELDS: { key: Field; label: string; clampMin: boolean }[] = [
  { key: 'x', label: 'X', clampMin: false },
  { key: 'y', label: 'Y', clampMin: false },
  { key: 'width', label: 'Width', clampMin: true },
  { key: 'height', label: 'Height', clampMin: true },
]

export function PropertiesForm() {
  const selectedLayerId = useCompositionStore((s) => s.selectedLayerId)
  const layer = useCompositionStore((s) =>
    s.layers.find((l) => l.id === selectedLayerId),
  )

  if (!layer) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500">
        select a layer to edit its properties
      </div>
    )
  }

  // key by id so local input state resets cleanly when the selection changes.
  return <LayerPropertiesForm key={layer.id} layer={layer} />
}

interface LayerPropertiesFormProps {
  layer: Layer
}

function LayerPropertiesForm({ layer }: LayerPropertiesFormProps) {
  const updateLayerTransform = useCompositionStore(
    (s) => s.updateLayerTransform,
  )

  // Local string drafts for the four inputs.
  const [drafts, setDrafts] = useState<Record<Field, string>>({
    x: String(layer.x),
    y: String(layer.y),
    width: String(layer.width),
    height: String(layer.height),
  })

  // Track which field is focused so an external store change (canvas drag /
  // resize) doesn't clobber the user mid-edit.
  const focusedField = useRef<Field | null>(null)

  // Sync local drafts from the store when the store value changes and the
  // field is NOT actively focused. This keeps the form in lockstep with canvas
  // interaction while preserving in-progress typing.
  useEffect(() => {
    setDrafts((prev) => ({
      x: focusedField.current === 'x' ? prev.x : String(layer.x),
      y: focusedField.current === 'y' ? prev.y : String(layer.y),
      width:
        focusedField.current === 'width' ? prev.width : String(layer.width),
      height:
        focusedField.current === 'height' ? prev.height : String(layer.height),
    }))
  }, [layer.x, layer.y, layer.width, layer.height])

  /** Commit a draft value to the store, applying clamping where required. */
  const commit = (field: Field, raw: string) => {
    const parsed = parseLayerNumber(raw)
    if (parsed === null) return // empty / invalid: don't write NaN to the store
    const spec = FIELDS.find((f) => f.key === field)!
    const value = spec.clampMin
      ? clampTransformValue(parsed, MIN_LAYER_SIZE)
      : parsed
    updateLayerTransform(layer.id, { [field]: value } as Pick<Layer, Field>)
    // Reflect any clamping back into the draft so the input shows the stored value.
    if (spec.clampMin && value !== parsed) {
      setDrafts((prev) => ({ ...prev, [field]: String(value) }))
    }
  }

  const handleChange = (field: Field, raw: string) => {
    setDrafts((prev) => ({ ...prev, [field]: raw }))
    // Write through immediately for valid values so the canvas tracks the form.
    commit(field, raw)
  }

  const handleFocus = (field: Field) => {
    focusedField.current = field
  }

  const handleBlur = (field: Field) => {
    focusedField.current = null
    const spec = FIELDS.find((f) => f.key === field)!
    const raw = drafts[field]
    const parsed = parseLayerNumber(raw)
    if (parsed === null) {
      // Empty / invalid on blur: revert to the authoritative store value.
      setDrafts((prev) => ({ ...prev, [field]: String(layer[field]) }))
      return
    }
    if (spec.clampMin) {
      const clamped = clampTransformValue(parsed, MIN_LAYER_SIZE)
      setDrafts((prev) => ({ ...prev, [field]: String(clamped) }))
      if (clamped !== parsed) {
        updateLayerTransform(layer.id, {
          [field]: clamped,
        } as Pick<Layer, Field>)
      }
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Filename
        </span>
        <span
          className="break-all font-medium text-slate-700"
          title={layer.originalFilename}
          data-testid="properties-filename"
        >
          {layer.originalFilename}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Natural size
        </span>
        <span className="text-slate-600" data-testid="properties-natural-size">
          {layer.naturalWidth} × {layer.naturalHeight}px
        </span>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Transform
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map(({ key, label }) => (
            <label
              key={key}
              className="flex flex-col gap-1"
              data-testid={`properties-field-${key}`}
            >
              <span className="text-xs text-slate-500">{label}</span>
              <input
                type="number"
                step={1}
                value={drafts[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                onFocus={() => handleFocus(key)}
                onBlur={() => handleBlur(key)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                data-testid={`properties-input-${key}`}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {layer.isBaseImage && (
        <p className="text-xs text-slate-400">
          The base image sets the canvas size and fills it exactly.
        </p>
      )}
    </div>
  )
}
