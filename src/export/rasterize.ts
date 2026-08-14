/**
 * Rasterize a self-contained SVG document string to an encoded image Blob via
 * an offscreen canvas — the DOM/impure half of the WebP export (the pure half
 * is `buildSvgDocument`, which produces the input string).
 *
 * Alpha is preserved end-to-end: the canvas is never pre-filled, so fully/partially
 * transparent regions (e.g. a transparent blank base) survive into the encoded
 * output — WebP carries an alpha channel; the PNG fallback inherently does.
 *
 * Not part of the pure/deterministic build path: touches `Image`, `canvas`,
 * and object URLs, so it is covered by e2e rather than unit tests (jsdom has
 * no rasterizer).
 */

/** Raster export formats `rasterizeSvg` can encode. */
export type RasterFormat = 'image/webp' | 'image/png'

/** Default quality for LOSSY encoders (WebP). PNG ignores the argument. */
export const DEFAULT_RASTER_QUALITY = 0.95

/**
 * Conservative canvas-AREA ceiling: 2^28 px (268 MP — Chromium's desktop
 * canvas-area limit, and comfortably above the app's own 144 MP upload cap).
 * Above it `toBlob` reliably fails, and some engines (iOS WebKit caps at
 * ~4096² ≈ 16.7 MP) fail SILENTLY — every draw is ignored and a BLANK image
 * encodes "successfully". The hard guard fails fast with a distinct code;
 * the silent-failure engines are caught by the probe inside `rasterizeSvg`.
 */
export const MAX_RASTER_AREA = 2 ** 28

let webpSupport: boolean | null = null

/**
 * Whether THIS browser can encode a canvas to WebP (`canvas.toBlob` /
 * `toDataURL` with `image/webp`). Chromium: yes. Firefox: yes (recent).
 * Safari: historically no — the exporter falls back to PNG there.
 *
 * Memoized: one probe canvas per session.
 */
export function canEncodeWebp(): boolean {
  if (webpSupport === null) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      // An encoder that can't do WebP ignores the type and returns a PNG URI.
      webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp')
    } catch {
      webpSupport = false
    }
  }
  return webpSupport
}

export interface RasterizeOptions {
  /** The standalone SVG document string (must carry width/height attrs). */
  svg: string
  /** Output pixel size — the canvas the SVG is painted into. */
  width: number
  height: number
  format: RasterFormat
  /** Encoder quality, 0..1 (lossy formats only). Defaults to 0.95. */
  quality?: number
}

/**
 * Rasterize an SVG string to an encoded Blob: object URL -> `HTMLImageElement`
 * -> `img.decode()` -> draw at 1:1 into an offscreen canvas -> `toBlob`.
 *
 * Rejections carry an Error whose `message` is a stable machine-readable code:
 *   - `svg_decode_failed` — the browser could not decode the SVG (malformed or
 *     a resource it refuses to load in an `<img>` context);
 *   - `canvas_too_large` — width×height exceeds `MAX_RASTER_AREA` (fail fast,
 *     before any allocation);
 *   - `canvas_blank` — the canvas backing store silently ignored drawing
 *     (the over-limit-canvas failure mode of some WebKit builds; caught by a
 *     1px probe + readback, so a blank image can never encode "successfully");
 *   - `raster_encode_failed` — no 2D context, or `toBlob` returned null.
 */
export async function rasterizeSvg(opts: RasterizeOptions): Promise<Blob> {
  const { svg, width, height, format } = opts
  const quality = opts.quality ?? DEFAULT_RASTER_QUALITY

  // Fail fast before allocating: a too-large canvas is at best a guaranteed
  // encode failure, at worst a silent blank encode (see MAX_RASTER_AREA).
  if (width * height > MAX_RASTER_AREA) throw new Error('canvas_too_large')

  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const img = new Image()
  img.decoding = 'sync'
  try {
    img.src = svgUrl
    try {
      await img.decode()
    } catch {
      throw new Error('svg_decode_failed')
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('raster_encode_failed')
    // Belt-and-braces for engines that ignore ALL drawing on an over-limit
    // canvas: probe with one opaque pixel and read it back BEFORE the real
    // content lands (so clearing the probe afterwards restores true
    // transparency, not "transparent where content should be"). A dead
    // backing store reads back (0,0,0,0) — and we refuse to encode blank.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1, 1)
    let probeOk = false
    try {
      const d = ctx.getImageData(0, 0, 1, 1).data
      probeOk = d[0] === 255 && d[3] === 255
    } catch {
      probeOk = false
    }
    if (!probeOk) throw new Error('canvas_blank')
    ctx.clearRect(0, 0, 1, 1)
    // No background fill: transparency in the SVG must reach the encoder.
    ctx.drawImage(img, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, format, quality),
    )
    if (blob === null) throw new Error('raster_encode_failed')
    return blob
  } finally {
    // The decode is complete (or failed) before this runs; the blob URL's
    // bytes are already in the image, so reclaiming now is safe.
    URL.revokeObjectURL(svgUrl)
  }
}
