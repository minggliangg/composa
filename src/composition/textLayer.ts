/**
 * Text layer factory (Step 6).
 *
 * A text layer is a synthetic overlay `Layer` whose `fullResBytesRef` is a
 * `text` payload. It flows through the existing `addOverlay` action untouched,
 * so selection, the layer list, reset, and undo all work with no further store
 * changes — exactly like `blankBase.ts`.
 *
 * Placement is at NATURAL size (measured from the seed content), centred on the
 * canvas with the `overlayIndex × 24` cascade. Deliberately NOT routed through
 * `computeOverlayPlacement`: that scales new layers to 45 % of the canvas short
 * side, which on a 4096 canvas blows the text up ~10×, makes the fontSize
 * control meaningless (rendered size = fontSize × scale), and makes "reset to
 * original size" collapse the text.
 */
import { createLayerId } from '../types/layer'
import type { Layer, CanvasConfig, TextContent } from '../types/layer'
import { measureText, defaultTextFontSize } from '../text/textMetrics'

/**
 * Build a text overlay seeded with "Text". The natural box is measured from that
 * seed so the layer starts at a sensible, on-grid size; `addOverlay` assigns the
 * z-index and selects it.
 */
export function createTextLayer(canvas: CanvasConfig, overlayCount: number): Layer {
  const fontSize = defaultTextFontSize(canvas)
  const text: TextContent = {
    content: 'Text',
    fontSize,
    fontWeight: 400,
    italic: false,
    // Default to the foreground token's light value so text reads on a white
    // base; theme-dependent fill is out of scope (text fill is stored data, not
    // a UI token, so it must not flip with the theme).
    fill: '#0f1714',
    align: 'left',
  }
  const measured = measureText(text.content, fontSize)
  const naturalWidth = measured.width
  const naturalHeight = measured.height
  // Centred, with the same cascade overlays use so successive adds stay distinct.
  const x = (canvas.width - naturalWidth) / 2 + overlayCount * 24
  const y = (canvas.height - naturalHeight) / 2 + overlayCount * 24
  return {
    id: createLayerId(),
    originalFilename: 'Text',
    name: null,
    mimeType: 'text/plain',
    // No preview URL: a text layer renders from its `text` payload, never from a
    // preview image. Every read is behind a `text` branch or a `blob:` guard.
    previewUrl: '',
    fullResBytesRef: { kind: 'text', text },
    x,
    y,
    width: naturalWidth,
    height: naturalHeight,
    naturalWidth,
    naturalHeight,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    visible: true,
    locked: false,
    isBaseImage: false,
  }
}
