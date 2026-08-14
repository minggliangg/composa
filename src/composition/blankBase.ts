/**
 * Blank base templates (the "fancy fox" plan, Phase 2).
 *
 * A composition cannot normally start without an uploaded base image, because
 * `canvas` is derived from the base's natural pixel size. A blank base is a
 * SYNTHETIC base `Layer`: it flows through the existing `setBaseImage` action
 * untouched, so export guards, the layer list, reset, and undo all work with no
 * store changes. It exports as a literal `<rect>` (see `buildSvgDocument`
 * `blank` source), so blank-base compositions rasterize correctly everywhere.
 *
 * The fill is `string | null`: the default white paints a solid `<rect>`;
 * `null` is a TRANSPARENT blank base — the rect paints nothing, so the canvas
 * shows the editor checkerboard and exports (SVG + rasterized WebP) keep their
 * alpha channel.
 */
import { createLayerId } from '../types/layer'
import type { Layer } from '../types/layer'

/** The 1:1 canvas sizes offered as one-click blank templates. */
export const BLANK_BASE_SIZES = [512, 1024, 2048, 4096] as const

/**
 * The preview data URI for a blank base of the given fill. Split out so
 * `createBlankBaseLayer` and the store's background toggle (`setBaseBackground`)
 * derive the IDENTICAL preview markup — they can never drift.
 *
 * `fill: null` still emits the `<rect>` (with `fill="none"`, so it paints
 * nothing): the `<image>` element in `LayerImage` keeps its shape, and the
 * editor checkerboard backdrop shows through.
 */
export function blankBasePreviewUrl(size: number, fill: string | null): string {
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="${fill ?? 'none'}"/></svg>`
  // Data URI: nothing to revoke. percent-encode so `#`/spaces/etc. are safe.
  return `data:image/svg+xml,${encodeURIComponent(markup)}`
}

/**
 * Build a synthetic base `Layer` representing a blank `<size>×<size>` canvas,
 * filled `fill` (default white) or transparent when `fill` is `null`.
 * `previewUrl` is a percent-encoded SVG data URI (not a blob — nothing to
 * revoke, and `revokePreview` already ignores non-`blob:` strings).
 *
 * Handed straight to `setBaseImage`, which forces `zIndex: 0`, `x/y = 0`,
 * `width/height = natural`, sets `canvas`, preserves overlays, and marks dirty.
 */
export function createBlankBaseLayer(
  size: number,
  fill: string | null = '#ffffff',
): Layer {
  return {
    id: createLayerId(),
    originalFilename: `blank-${size}.svg`,
    name: null,
    mimeType: 'image/svg+xml',
    previewUrl: blankBasePreviewUrl(size, fill),
    fullResBytesRef: { kind: 'blank', fill },
    x: 0,
    y: 0,
    width: size,
    height: size,
    naturalWidth: size,
    naturalHeight: size,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    visible: true,
    locked: false,
    isBaseImage: true,
  }
}
