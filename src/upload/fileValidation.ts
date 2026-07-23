/**
 * Cheap client-side MIME pre-check for immediate feedback. This is NOT the
 * authoritative gate — the WASM magic-byte sniff (Phase 07) is, because a file's
 * declared MIME/extension can lie. We reject only when BOTH the declared MIME
 * type AND the extension are unrecognized, so a renamed/under-typed image still
 * reaches the authoritative WASM gate rather than being blocked on a hunch.
 */
export const ACCEPTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number]

/** Extensions matched against the lowercased filename suffix. */
export const ACCEPTED_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
] as const

/** Type guard: does this MIME type claim to be one we might accept? */
export function isAcceptedMimeType(mimeType: string): mimeType is AcceptedMimeType {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mimeType)
}

/** Does this filename end with one of the accepted extensions (case-insensitive)? */
export function isAcceptedExtension(filename: string): boolean {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return false
  const ext = filename.slice(dot).toLowerCase()
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)
}

/** Max source dimension in pixels; over this the WASM layer rejects the input. */
export const MAX_SOURCE_DIMENSION = 12_000

export type ImageFileValidation = { ok: true } | { ok: false; reason: string }

/**
 * Fast client-side validation combining the declared MIME type and the filename
 * extension. Returns a short stable reason code on failure (the only failure
 * mode here is `"unsupported_format"`; `"dimensions_too_large"` is checked
 * later, once natural dimensions are known).
 */
export function validateImageFile(file: File): ImageFileValidation {
  const mimeOk = isAcceptedMimeType(file.type)
  const extOk = isAcceptedExtension(file.name)
  if (!mimeOk && !extOk) {
    return { ok: false, reason: 'unsupported_format' }
  }
  return { ok: true }
}
