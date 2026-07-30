import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { CanvasConfig, FullResBytesRef, Layer } from '../../types/layer'
import { createLayerId } from '../../types/layer'
import { useCompositionStore } from '../../state/compositionStore'
import {
  MAX_SOURCE_DIMENSION,
  isSvgFile,
  validateImageFile,
} from '../../upload/fileValidation'
import { wasmErrorMessage } from '../../upload/errorMessages'
import { parseSvgSource } from '../../upload/svgSource'
import { probeDimensions, decodeAndDownscale } from '../../wasm/imageProcessor'
import { BLANK_BASE_SIZES, createBlankBaseLayer } from '../../composition/blankBase'
import { ConfirmDialog } from '../../components/ConfirmDialog'

const ACCEPT_ATTR =
  'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg'

/**
 * Larger side of a decoded PREVIEW, in pixels. Previews are downscaled to this
 * (never upscaled) so canvas interaction stays smooth regardless of the source
 * resolution; the full-resolution original `File` is retained separately for
 * export. 2048 is comfortably below `MAX_SOURCE_DIMENSION` and large enough
 * that small uploads (e.g. E2E fixtures) pass through unmodified.
 */
const MAX_PREVIEW_DIM = 2048

interface UploadError {
  filename: string
  reason: string
}

interface DecodedImage {
  previewUrl: string
  naturalWidth: number
  naturalHeight: number
  /** Full-resolution source for export — raster `File`, or sanitized SVG. */
  fullResBytesRef: FullResBytesRef
}

/**
 * Decode an upload into a preview + natural dims + export source.
 *
 * SVG takes a WASM-FREE path: read as text, sanitize + size via
 * `parseSvgSource`, and surface the sanitized markup both as a blob preview
 * URL and as the `svg` `fullResBytesRef`. The blob URL renders in the
 * browser's *secure static mode* (no script, no external fetches), so the live
 * editor is safe regardless of sanitizer coverage; `revokePreview` in the store
 * reclaims `blob:` URLs with zero changes.
 *
 * Everything else runs the worker-backed raster path: probe TRUE natural
 * dimensions via WASM magic-byte sniffing (authoritative — the declared
 * MIME/extension can lie), then decode + downscale to `MAX_PREVIEW_DIM` in the
 * Web Worker so the UI thread never blocks. The original `File` is retained as
 * the export source.
 *
 * `err.message` from the proxy is the stable WASM error code; we map it to
 * user-facing copy via `wasmErrorMessage` so this throws Error objects whose
 * `message` is already human-readable.
 */
async function decodeImagePreview(file: File): Promise<DecodedImage> {
  // SVG bypasses WASM entirely — the `image` crate cannot decode vectors.
  if (isSvgFile(file)) {
    const text = await file.text()
    const result = parseSvgSource(text)
    if (!result.ok) {
      throw new Error(wasmErrorMessage(result.reason))
    }
    const blob = new Blob([result.markup], { type: 'image/svg+xml' })
    return {
      previewUrl: URL.createObjectURL(blob),
      naturalWidth: result.naturalWidth,
      naturalHeight: result.naturalHeight,
      fullResBytesRef: {
        kind: 'svg',
        markup: result.markup,
        viewBox: result.viewBox,
      },
    }
  }

  let dims: { width: number; height: number }
  try {
    dims = await probeDimensions(file)
  } catch (err) {
    const code = err instanceof Error ? err.message : 'decode_failed'
    throw new Error(wasmErrorMessage(code))
  }
  // Fast client-side feedback before the (also authoritative) Rust check; the
  // worker would reject anyway, but this skips the decode round-trip.
  if (dims.width > MAX_SOURCE_DIMENSION || dims.height > MAX_SOURCE_DIMENSION) {
    throw new Error(wasmErrorMessage('dimensions_too_large'))
  }
  let previewBlob: Blob
  try {
    previewBlob = await decodeAndDownscale(file, MAX_PREVIEW_DIM)
  } catch (err) {
    const code = err instanceof Error ? err.message : 'decode_failed'
    throw new Error(wasmErrorMessage(code))
  }
  return {
    previewUrl: URL.createObjectURL(previewBlob),
    naturalWidth: dims.width,
    naturalHeight: dims.height,
    fullResBytesRef: { kind: 'file', file },
  }
}

/**
 * Deterministic default size + position for a newly-added overlay.
 *
 * Formula:
 *   targetLongSide = 0.45 * min(canvas.width, canvas.height)
 *   scale          = targetLongSide / max(naturalWidth, naturalHeight)
 *   width          = naturalWidth  * scale   (aspect ratio preserved)
 *   height         = naturalHeight * scale
 *   baseX          = (canvas.width  - width)  / 2   (centered)
 *   baseY          = (canvas.height - height) / 2
 *   offset         = overlayIndex * 24   (cascade so stacked uploads stay distinct)
 *
 * `overlayIndex` is the 0-based count of overlays already in the composition at
 * the moment this overlay is placed, so each successive upload shifts +24 canvas
 * units on both axes and never perfectly overlaps the previous one.
 */
function computeOverlayPlacement(
  naturalWidth: number,
  naturalHeight: number,
  canvas: CanvasConfig,
  overlayIndex: number,
): { x: number; y: number; width: number; height: number } {
  const targetLongSide = 0.45 * Math.min(canvas.width, canvas.height)
  const scale = targetLongSide / Math.max(naturalWidth, naturalHeight)
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  const baseX = (canvas.width - width) / 2
  const baseY = (canvas.height - height) / 2
  const offset = overlayIndex * 24
  return { x: baseX + offset, y: baseY + offset, width, height }
}

const DROP_AREA_CLASS =
  'flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed border-border-strong bg-raised p-3 text-center transition-colors hover:border-fg-muted hover:bg-raised-hover'

/** Shared upload affordance icon — a frame with an upward arrow — used above
 *  each drop area's labels. currentColor lets the parent tint it. */
function UploadGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="text-fg-subtle"
    >
      <path
        d="M10 14V4M10 4L6 8M10 4L14 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 13v3a1.5 1.5 0 0 0 1.5 1.5h10A1.5 1.5 0 0 0 16.5 16v-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Base + overlay upload dropzone. Each labeled area is a `<label>` wrapping a
 * visually-hidden `<input type="file">` so a click opens the native picker and
 * drag-and-drop lands on the same element. Base takes a single file and sets the
 * canvas; overlays accept multiple files, validated + decoded in turn.
 */
export function UploadDropzone() {
  const canvas = useCompositionStore((s) => s.canvas)
  const layers = useCompositionStore((s) => s.layers)
  const setBaseImage = useCompositionStore((s) => s.setBaseImage)
  const addOverlay = useCompositionStore((s) => s.addOverlay)

  const [errors, setErrors] = useState<UploadError[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  // Pending blank-size selection awaiting confirmation (only set when replacing
  // an existing base — a fresh canvas needs no confirmation).
  const [blankReplace, setBlankReplace] = useState<number | null>(null)
  // State updates are asynchronous, so use an immediate lock as well as
  // `isProcessing` to reject rapid picker events before the next render.
  const processingRef = useRef(false)

  const hasBase = canvas !== null
  const overlayCount = layers.filter((l) => !l.isBaseImage).length

  const beginProcessing = (): boolean => {
    if (processingRef.current) return false
    processingRef.current = true
    setIsProcessing(true)
    return true
  }

  const finishProcessing = (): void => {
    processingRef.current = false
    setIsProcessing(false)
  }

  /**
   * Start from a blank canvas. With no existing base this is immediate; when a
   * base already exists, route through the shared ConfirmDialog — replacing a
   * base looks destructive even though overlays survive (setBaseImage keeps
   * them). Mirrors the confirm pattern LayerList uses for delete.
   */
  const handleBlank = (size: number): void => {
    if (hasBase) {
      setBlankReplace(size)
    } else {
      setBaseImage(createBlankBaseLayer(size))
    }
  }

  const confirmBlankReplace = (): void => {
    if (blankReplace == null) return
    setBaseImage(createBlankBaseLayer(blankReplace))
    setBlankReplace(null)
  }

  const handleBaseFiles = async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files)
    if (list.length === 0) return
    if (!beginProcessing()) return
    const file = list[0]
    setErrors([])
    const validation = validateImageFile(file)
    if (!validation.ok) {
      setErrors([
        { filename: file.name, reason: wasmErrorMessage(validation.reason) },
      ])
      finishProcessing()
      return
    }
    try {
      // decodeImagePreview probes + downscales in the Worker; natural dims come
      // from the WASM sniff (authoritative), the preview is a downscaled PNG
      // object URL. Dimension cap + format errors throw with human copy.
      const decoded = await decodeImagePreview(file)
      const baseLayer: Layer = {
        id: createLayerId(),
        originalFilename: file.name,
        mimeType: file.type,
        previewUrl: decoded.previewUrl,
        fullResBytesRef: decoded.fullResBytesRef,
        x: 0,
        y: 0,
        width: decoded.naturalWidth,
        height: decoded.naturalHeight,
        naturalWidth: decoded.naturalWidth,
        naturalHeight: decoded.naturalHeight,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        visible: true,
        locked: false,
        isBaseImage: true,
      }
      setBaseImage(baseLayer)
    } catch (err) {
      const reason =
        err instanceof Error && err.message
          ? err.message
          : wasmErrorMessage('decode_failed')
      setErrors([{ filename: file.name, reason }])
    } finally {
      finishProcessing()
    }
  }

  const handleOverlayFiles = async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files)
    if (list.length === 0) return
    if (!beginProcessing()) return
    setErrors([])
    const newErrors: UploadError[] = []
    let placementIndex = overlayCount
    try {
      for (const file of list) {
        const validation = validateImageFile(file)
        if (!validation.ok) {
          newErrors.push({
            filename: file.name,
            reason: wasmErrorMessage(validation.reason),
          })
          continue
        }
        try {
          const decoded = await decodeImagePreview(file)
          if (!canvas) {
            // Defensive: the overlay input is disabled until a base exists, so
            // this is effectively unreachable in the UI — still revoke + report
            // rather than leak the preview URL if it ever is reached.
            URL.revokeObjectURL(decoded.previewUrl)
            newErrors.push({
              filename: file.name,
              reason: 'Upload a base image first.',
            })
            continue
          }
          const placement = computeOverlayPlacement(
            decoded.naturalWidth,
            decoded.naturalHeight,
            canvas,
            placementIndex,
          )
          const overlayLayer: Layer = {
            id: createLayerId(),
            originalFilename: file.name,
            mimeType: file.type,
            previewUrl: decoded.previewUrl,
            fullResBytesRef: decoded.fullResBytesRef,
            x: placement.x,
            y: placement.y,
            width: placement.width,
            height: placement.height,
            naturalWidth: decoded.naturalWidth,
            naturalHeight: decoded.naturalHeight,
            rotation: 0,
            opacity: 1,
            zIndex: 0,
            visible: true,
            locked: false,
            isBaseImage: false,
          }
          addOverlay(overlayLayer)
          placementIndex += 1
        } catch (err) {
          const reason =
            err instanceof Error && err.message
              ? err.message
              : wasmErrorMessage('decode_failed')
          newErrors.push({ filename: file.name, reason })
        }
      }
    } finally {
      if (newErrors.length > 0) setErrors(newErrors)
      finishProcessing()
    }
  }

  const onDragOver = (e: DragEvent) => e.preventDefault()

  const onDropBase = (e: DragEvent) => {
    e.preventDefault()
    if (isProcessing) return
    if (e.dataTransfer.files.length > 0) {
      void handleBaseFiles(e.dataTransfer.files)
    }
  }

  const onDropOverlay = (e: DragEvent) => {
    e.preventDefault()
    if (isProcessing || !hasBase) return
    if (e.dataTransfer.files.length > 0) {
      void handleOverlayFiles(e.dataTransfer.files)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        onDragOver={onDragOver}
        onDrop={onDropBase}
        className={DROP_AREA_CLASS}
      >
        <input
          type="file"
          accept={ACCEPT_ATTR}
          disabled={isProcessing}
          className="sr-only"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : []
            e.target.value = ''
            if (isProcessing || processingRef.current) return
            if (files && files.length > 0) {
              void handleBaseFiles(files)
            }
          }}
        />
        <UploadGlyph />
        <span className="text-sm font-medium text-fg">Base image</span>
        <span className="text-xs text-fg-muted">
          click or drop one image — sets canvas size
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-fg-muted">
          or start from a blank canvas
        </span>
        <div className="grid grid-cols-4 gap-1.5">
          {BLANK_BASE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => handleBlank(size)}
              disabled={isProcessing}
              className="rounded-md border border-border bg-raised px-1 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-fg-muted hover:bg-raised-hover hover:text-fg focus:outline-none focus:ring-2 focus:ring-fg-muted/40 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid={`blank-base-${size}`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      <label
        onDragOver={onDragOver}
        onDrop={onDropOverlay}
        aria-disabled={!hasBase}
        className={`${DROP_AREA_CLASS} ${!hasBase ? 'pointer-events-none cursor-not-allowed opacity-50' : ''}`}
      >
        <input
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          disabled={!hasBase || isProcessing}
          className="sr-only"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : []
            e.target.value = ''
            if (isProcessing || processingRef.current) return
            if (files && files.length > 0) {
              void handleOverlayFiles(files)
            }
          }}
        />
        <UploadGlyph />
        <span className="text-sm font-medium text-fg">Overlays</span>
        <span className="text-xs text-fg-muted">
          {hasBase
            ? 'click or drop — stack above the base'
            : 'upload a base image first'}
        </span>
      </label>

      {isProcessing && (
        <p
          className="text-xs text-fg-muted"
          aria-live="polite"
          data-testid="upload-processing"
        >
          processing…
        </p>
      )}

      {errors.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger-fg">
          {errors.map((err, i) => (
            <li key={`${err.filename}-${i}`}>
              <span className="font-medium">{err.filename}</span>
              <span className="text-danger"> — {err.reason}</span>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={blankReplace !== null}
        title="Replace the base?"
        message={`Start a new ${blankReplace ?? ''}×${blankReplace ?? ''} blank canvas? Existing overlays are kept, but the current base will be replaced.`}
        confirmLabel="Replace"
        cancelLabel="Cancel"
        destructive
        onConfirm={confirmBlankReplace}
        onCancel={() => setBlankReplace(null)}
      />
    </div>
  )
}
