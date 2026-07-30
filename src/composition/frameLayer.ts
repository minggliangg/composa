/**
 * Frame layer factory (Slice C — "frame the selection").
 *
 * A frame is a synthetic `rect` overlay `Layer` whose box encloses the selected
 * layers' VISIBLE bounds and whose `border` is the visible frame. It flows
 * through the existing `addOverlay` action untouched, so selection, the layer
 * list, reset, and undo all work with no further store changes — exactly like
 * `textLayer.ts` / `blankBase.ts`.
 *
 * The frame padding is stored as the layer's `border.padding` (NOT baked into the
 * box), so it stays editable in the Border controls afterwards.
 */
import { createLayerId } from '../types/layer'
import type { Layer } from '../types/layer'
import { MIN_LAYER_SIZE } from '../canvas/resize'
import {
  borderOuterRect,
  normalizeBorder,
  DEFAULT_BORDER_COLOR,
  DEFAULT_BORDER_WIDTH,
} from '../canvas/border'

/** Default gap between the framed content's outer bounds and the frame border. */
export const DEFAULT_FRAME_PADDING = 8

export interface FrameOptions {
  /** Gap between the framed content's OUTER bounds and the border. Stored as the
   *  frame's `border.padding`, NOT baked into the box, so it stays editable in
   *  the Border controls afterwards. */
  padding?: number
  /** Interior fill, or `null` (default) for a transparent frame. */
  fill?: string | null
  color?: string
  width?: number
}

/**
 * Build a frame overlay enclosing `layers`; `null` for an empty list. The box is
 * the min/max over each layer's VISIBLE (outer) bounds (`borderOuterRect`), so a
 * frame never slices through a member's own border.
 */
export function createFrameLayer(layers: Layer[], opts?: FrameOptions): Layer | null {
  if (layers.length === 0) return null

  const outers = layers.map(borderOuterRect)
  const minX = Math.min(...outers.map((o) => o.x))
  const minY = Math.min(...outers.map((o) => o.y))
  const maxX = Math.max(...outers.map((o) => o.x + o.width))
  const maxY = Math.max(...outers.map((o) => o.y + o.height))
  const width = Math.max(MIN_LAYER_SIZE, maxX - minX)
  const height = Math.max(MIN_LAYER_SIZE, maxY - minY)

  // padding lives on the border, not the box. normalizeBorder floors/snaps it.
  const border = normalizeBorder({
    color: opts?.color ?? DEFAULT_BORDER_COLOR,
    width: opts?.width ?? DEFAULT_BORDER_WIDTH,
    padding: opts?.padding ?? DEFAULT_FRAME_PADDING,
  })

  return {
    id: createLayerId(),
    originalFilename: 'Frame',
    name: null,
    mimeType: 'image/svg+xml',
    // Never read: the layer list renders no thumbnail and revokePreview ignores
    // non-`blob:` strings.
    previewUrl: '',
    fullResBytesRef: { kind: 'rect', fill: opts?.fill ?? null },
    x: minX,
    y: minY,
    width,
    height,
    // Equal to the box dims so isLayerDistorted/isLayerResized are false and the
    // reset buttons stay inert (addOverlay quantizes the box, which is a no-op
    // for on-grid inputs — the members' positions/sizes are already on-grid).
    naturalWidth: width,
    naturalHeight: height,
    rotation: 0,
    opacity: 1,
    // addOverlay overwrites this to the top z-index.
    zIndex: 0,
    visible: true,
    locked: false,
    isBaseImage: false,
    border,
  }
}
