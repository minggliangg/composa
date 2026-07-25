/**
 * Alignment toolbar (Phase: alignment tool).
 *
 * Renders three button groups that act on the current selection, writing every
 * result through the store's `updateLayersTransform` seam (which also snaps to
 * the half-pixel grid):
 *
 *   - Align to canvas   — needs >= 1 selected layer.
 *   - Align to selection — needs >= 2 (aligns to the selection bounding box).
 *   - Distribute        — needs >= 3 (equalizes center spacing).
 *
 * The base image is never aligned (it pins the canvas). The toolbar is only
 * shown when at least one layer is selected.
 */
import type { ReactNode } from 'react'
import { useCompositionStore } from '../../state/compositionStore'
import {
  alignToCanvas,
  alignToSelection,
  distribute,
} from '../../canvas/align'
import type {
  AlignRect,
  AlignTarget,
  DistributeAxis,
} from '../../canvas/align'
import type { Layer } from '../../types/layer'

/** Geometry of the alignment-bar drawn inside a 16x16 icon, per target. */
const BAR_GEOM: Record<AlignTarget, { x: number; y: number; w: number; h: number }> = {
  left: { x: 1.5, y: 4, w: 3, h: 8 },
  'center-h': { x: 6.5, y: 4, w: 3, h: 8 },
  right: { x: 11.5, y: 4, w: 3, h: 8 },
  top: { x: 4, y: 1.5, w: 8, h: 3 },
  'center-v': { x: 4, y: 6.5, w: 8, h: 3 },
  bottom: { x: 4, y: 11.5, w: 8, h: 3 },
}

const CANVAS_TARGETS: { target: AlignTarget; label: string }[] = [
  { target: 'left', label: 'Align left to canvas' },
  { target: 'center-h', label: 'Center horizontally on canvas' },
  { target: 'right', label: 'Align right to canvas' },
  { target: 'top', label: 'Align top to canvas' },
  { target: 'center-v', label: 'Center vertically on canvas' },
  { target: 'bottom', label: 'Align bottom to canvas' },
]

const SELECTION_TARGETS: { target: AlignTarget; label: string }[] = [
  { target: 'left', label: 'Align left edges' },
  { target: 'center-h', label: 'Center horizontally' },
  { target: 'right', label: 'Align right edges' },
  { target: 'top', label: 'Align top edges' },
  { target: 'center-v', label: 'Center vertically' },
  { target: 'bottom', label: 'Align bottom edges' },
]

const DISTRIBUTE_AXES: { axis: DistributeAxis; label: string }[] = [
  { axis: 'horizontal', label: 'Distribute horizontal spacing' },
  { axis: 'vertical', label: 'Distribute vertical spacing' },
]

function AlignIcon({ target }: { target: AlignTarget }) {
  const bar = BAR_GEOM[target]
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {/* Boundary frame */}
      <rect
        x="0.75"
        y="0.75"
        width="14.5"
        height="14.5"
        rx="1.5"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1"
      />
      <rect
        x={bar.x}
        y={bar.y}
        width={bar.w}
        height={bar.h}
        rx="0.75"
        fill="currentColor"
      />
    </svg>
  )
}

function DistributeIcon({ axis }: { axis: DistributeAxis }) {
  const bars =
    axis === 'horizontal'
      ? [
          { x: 1.5, y: 4, w: 2.5, h: 8 },
          { x: 6.75, y: 4, w: 2.5, h: 8 },
          { x: 12, y: 4, w: 2.5, h: 8 },
        ]
      : [
          { x: 4, y: 1.5, w: 8, h: 2.5 },
          { x: 4, y: 6.75, w: 8, h: 2.5 },
          { x: 4, y: 12, w: 8, h: 2.5 },
        ]
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {bars.map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx="0.75"
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

interface ToolButtonProps {
  label: string
  testId: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function ToolButton({ label, testId, disabled, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-slate-300 transition-colors hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

function Group({
  legend,
  min,
  count,
  children,
}: {
  legend: string
  /** Minimum selection count this group needs to be enabled. */
  min: number
  count: number
  children: ReactNode
}) {
  const enabled = count >= min
  return (
    <fieldset className="flex flex-col gap-1" disabled={!enabled}>
      <legend className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {legend}
        {!enabled && (
          <span className="font-normal normal-case text-slate-600">
            (needs {min}+)
          </span>
        )}
      </legend>
      <div className="flex flex-wrap gap-1">{children}</div>
    </fieldset>
  )
}

export function AlignmentToolbar() {
  const layers = useCompositionStore((s) => s.layers)
  const selectedLayerIds = useCompositionStore((s) => s.selectedLayerIds)
  const canvas = useCompositionStore((s) => s.canvas)
  const updateLayersTransform = useCompositionStore(
    (s) => s.updateLayersTransform,
  )

  if (!canvas) return null

  // Resolve selected non-base layers to alignment rects.
  const rects: AlignRect[] = selectedLayerIds
    .map((id) => layers.find((l) => l.id === id))
    .filter((l): l is Layer => Boolean(l))
    .filter((l) => !l.isBaseImage)
    .map((l) => ({
      id: l.id,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
    }))

  if (rects.length === 0) return null
  const n = rects.length

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-800 bg-slate-900/60 p-3 text-sm">
      <Group legend="Align to canvas" min={1} count={n}>
        {CANVAS_TARGETS.map(({ target, label }) => (
          <ToolButton
            key={target}
            label={label}
            testId={`align-canvas-${target}`}
            disabled={n < 1}
            onClick={() =>
              updateLayersTransform(alignToCanvas(rects, canvas, target))
            }
          >
            <AlignIcon target={target} />
          </ToolButton>
        ))}
      </Group>

      <Group legend="Align to selection" min={2} count={n}>
        {SELECTION_TARGETS.map(({ target, label }) => (
          <ToolButton
            key={target}
            label={label}
            testId={`align-selection-${target}`}
            disabled={n < 2}
            onClick={() =>
              updateLayersTransform(alignToSelection(rects, target))
            }
          >
            <AlignIcon target={target} />
          </ToolButton>
        ))}
      </Group>

      <Group legend="Distribute" min={3} count={n}>
        {DISTRIBUTE_AXES.map(({ axis, label }) => (
          <ToolButton
            key={axis}
            label={label}
            testId={`distribute-${axis}`}
            disabled={n < 3}
            onClick={() => updateLayersTransform(distribute(rects, axis))}
          >
            <DistributeIcon axis={axis} />
          </ToolButton>
        ))}
      </Group>
    </div>
  )
}
