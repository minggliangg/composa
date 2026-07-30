/**
 * Maps the stable machine-readable error codes emitted by the Rust/WASM
 * `image-processor` crate (see `crates/image-processor/src/lib.rs` ->
 * `ProcError::code`) to human-facing copy shown in the upload UI.
 *
 * The Rust side deliberately never leaks the `image` crate's own error text
 * (which can contain paths/bytes and is meaningless to users); it surfaces only
 * these short codes. This function is the single place that turns a code into
 * user copy, so the worker/proxy layers can stay free of presentation strings.
 *
 * Pure and synchronous — unit-tested directly (no WASM/Worker needed).
 */

/** User-facing copy for the "I don't recognize these bytes" code. */
const UNSUPPORTED_FORMAT =
  'Unsupported image format. Use PNG, JPEG, GIF, WebP, or SVG.'

/** User-facing copy for the "bytes looked valid but failed to decode" code. */
const DECODE_FAILED = 'This image appears to be corrupt or truncated.'

/** User-facing copy for the "either dimension exceeds the cap" code. */
const DIMENSIONS_TOO_LARGE =
  'This image is too large (max 12000px per side).'

/** User-facing copy for the "SVG text failed to parse / wasn't an <svg>" code. */
const SVG_PARSE_FAILED =
  'This SVG could not be parsed. Check that it is valid SVG markup.'

/** User-facing copy for the "SVG source text exceeded the byte cap" code. */
const SVG_TOO_LARGE = 'This SVG is too large (max 2 MB of source text).'

/** Fallback for any code the WASM layer did not document (forward-compat). */
const UNKNOWN_ERROR = 'Could not process this image. Try a different file.'

/**
 * Return user-facing copy for a stable error code. These originated on the
 * Rust/WASM side, but the SVG path (parsed in TS) reuses the same code→copy
 * table — `svg_parse_failed` / `svg_too_large` are emitted by `parseSvgSource`,
 * and `dimensions_too_large` is shared with the raster cap. Unknown codes fall
 * back to a generic message so a future code never renders as `undefined`.
 */
export function wasmErrorMessage(code: string): string {
  switch (code) {
    case 'unsupported_format':
      return UNSUPPORTED_FORMAT
    case 'decode_failed':
      return DECODE_FAILED
    case 'dimensions_too_large':
      return DIMENSIONS_TOO_LARGE
    case 'svg_parse_failed':
      return SVG_PARSE_FAILED
    case 'svg_too_large':
      return SVG_TOO_LARGE
    default:
      return UNKNOWN_ERROR
  }
}
