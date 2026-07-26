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
import { isLayerDistorted, isLayerResized } from './transformValidation'

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

/** A rect leaning back toward its natural ratio (diagonal slash = "reset"). */
function ResetAspectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.75"
        y="4.75"
        width="10.5"
        height="6.5"
        rx="1"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1.1"
      />
      <line
        x1="3.75"
        y1="11.75"
        x2="12.25"
        y2="4.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** A large dashed outer rect (current size) with a smaller solid inner rect
 *  (natural/original size) centered inside it — the "shrink to original size"
 *  gesture. Parallel sibling to ResetAspectIcon. */
function ResetSizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.25"
        y="4.25"
        width="11.5"
        height="7.5"
        rx="1"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1"
        strokeDasharray="2 1.5"
      />
      <rect
        x="5.5"
        y="6"
        width="5"
        height="4"
        rx="0.75"
        fill="currentColor"
      />
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
      className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-fg-muted transition-colors hover:bg-raised-hover hover:text-fg focus:outline-none focus:ring-2 focus:ring-fg-muted/40 disabled:cursor-not-allowed disabled:text-fg-subtle disabled:hover:bg-transparent"
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
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {legend}
        {!enabled && (
          <span className="font-normal normal-case text-fg-subtle">
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
  const resetLayersAspect = useCompositionStore((s) => s.resetLayersAspect)
  const resetLayersToOriginalSize = useCompositionStore(
    (s) => s.resetLayersToOriginalSize,
  )

  if (!canvas) return null

  // Resolve selected non-base layers to alignment rects.
  const selectedOverlays = selectedLayerIds
    .map((id) => layers.find((l) => l.id === id))
    .filter((l): l is Layer => Boolean(l))
    .filter((l) => !l.isBaseImage)
  const rects: AlignRect[] = selectedOverlays.map((l) => ({
    id: l.id,
    x: l.x,
    y: l.y,
    width: l.width,
    height: l.height,
  }))

  if (rects.length === 0) return null
  const n = rects.length
  // Any selected overlay whose rendered ratio drifts from its source can be
  // reverted; the button is inert when every selection already matches.
  const anyDistorted = selectedOverlays.some(isLayerDistorted)
  // Any selected overlay whose rendered size differs from its source pixel
  // dims can be reset to original size; inert when all already match.
  const anyResized = selectedOverlays.some(isLayerResized)

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-raised/50 p-3 text-sm">
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

      {/* Revert each selected layer to its source aspect ratio (hold width,
          recenter). Inert when every selection already matches its natural
          ratio — rare for drag-resized layers (corners preserve ratio), common
          after typing in the W/H fields. */}
      <Group legend="Reset" min={1} count={n}>
        <ToolButton
          label="Reset aspect ratio"
          testId="reset-aspect"
          disabled={!anyDistorted}
          onClick={() => resetLayersAspect(selectedOverlays.map((l) => l.id))}
        >
          <ResetAspectIcon />
        </ToolButton>
        {/* Reset to source pixel dimensions (naturalWidth × naturalHeight),
            recentered on both axes. Inert when every selection is already at
            its natural size — unusual for overlays (uploads scale to ~45% of
            the canvas), so this is usually enabled. */}
        <ToolButton
          label="Reset to original size"
          testId="reset-size"
          disabled={!anyResized}
          onClick={() =>
            resetLayersToOriginalSize(selectedOverlays.map((l) => l.id))
          }
        >
          <ResetSizeIcon />
        </ToolButton>
      </Group>
    </div>
  )
}
