//! composa. image-processor — Rust/WASM image codec module.
//!
//! Decodes uploaded images, produces downscaled PNG previews for smooth canvas
//! interaction, and re-encodes the full-resolution original for the exported
//! SVG. Intended to run inside a Web Worker (off the UI thread); the functions
//! here are single-threaded and synchronous.
//!
//! Architecture: the heavy lifting lives in plain, testable internal functions
//! (`*_inner`) that return a [`ProcError`]. The `#[wasm_bindgen]` exports are
//! thin wrappers that map each [`ProcError`] to a short, stable machine-readable
//! code string. The underlying `image` crate error text is never propagated
//! across the wasm boundary.

use base64::Engine as _;
use std::io::Cursor;
use wasm_bindgen::prelude::*;

/// Maximum allowed natural dimension (width OR height) of any source image, in
/// pixels. Inputs exceeding this on either axis are rejected with
/// `dimensions_too_large` rather than risking pathological decode times or
/// memory blowups on huge uploads.
pub const MAX_SOURCE_DIMENSION: u32 = 12_000;

// ---------------------------------------------------------------------------
// Internal error type
// ---------------------------------------------------------------------------

/// Errors raised by the core (non-wasm) image routines.
///
/// Deliberately coarse-grained: each variant maps 1:1 to a stable code string
/// consumed by the JS wrapper, which turns it into user-facing copy. We never
/// leak the `image` crate's own error text (it can contain paths/bytes and is
/// meaningless to end users).
#[derive(Debug)]
enum ProcError {
    /// Magic-byte sniff failed, or the sniffed format is not one we enabled
    /// (PNG/JPEG/GIF/WebP). Corresponds to `image::ImageError::Unsupported`.
    UnsupportedFormat,
    /// The format was sniffed but the bytes failed to decode, or a re-encode
    /// step failed. Catch-all for every other `image::ImageError` variant.
    DecodeFailed,
    /// Either natural dimension exceeds [`MAX_SOURCE_DIMENSION`].
    DimensionsTooLarge,
}

impl ProcError {
    /// Stable machine-readable code string exposed to JS via `JsValue::from_str`.
    fn code(&self) -> &'static str {
        match self {
            ProcError::UnsupportedFormat => "unsupported_format",
            ProcError::DecodeFailed => "decode_failed",
            ProcError::DimensionsTooLarge => "dimensions_too_large",
        }
    }
}

impl From<image::ImageError> for ProcError {
    fn from(err: image::ImageError) -> Self {
        // `image::load_from_memory` guesses the format from magic bytes; a
        // completely unknown format (or one we did not enable) surfaces as
        // `ImageError::Unsupported`. Everything else — decode corruption,
        // limits, io, encoding — means the bytes looked like a nominally
        // supported image but were broken, so it collapses to `DecodeFailed`.
        match err {
            image::ImageError::Unsupported(_) => ProcError::UnsupportedFormat,
            _ => ProcError::DecodeFailed,
        }
    }
}

// ---------------------------------------------------------------------------
// Core (non-wasm) logic — pure Rust, callable from native `cargo test`
// ---------------------------------------------------------------------------

/// Reject if either natural dimension exceeds [`MAX_SOURCE_DIMENSION`].
fn check_dimensions(width: u32, height: u32) -> Result<(), ProcError> {
    if width > MAX_SOURCE_DIMENSION || height > MAX_SOURCE_DIMENSION {
        Err(ProcError::DimensionsTooLarge)
    } else {
        Ok(())
    }
}

/// Magic-byte sniff + decode via the `image` crate, then enforce the source
/// dimension cap on the natural (decoded) size.
///
/// NOTE on animated GIF: `image::load_from_memory` decodes only the **first
/// frame** of an animated GIF and discards the rest. composa. therefore treats
/// GIFs as first-frame-only for both preview and export — animation is out of
/// scope for the MVP and is surfaced to the user via help text. This matches
/// the documented Phase 07 behavior.
fn load_image(bytes: &[u8]) -> Result<image::DynamicImage, ProcError> {
    let img = image::load_from_memory(bytes)?;
    check_dimensions(img.width(), img.height())?;
    Ok(img)
}

/// Downscale `img` so its larger side equals `max_dim`, preserving aspect
/// ratio and alpha. Never upscales: if the image already fits within `max_dim`
/// on both axes, it is returned unchanged (a clone).
fn downscale(img: &image::DynamicImage, max_dim: u32) -> image::DynamicImage {
    let (w, h) = (img.width(), img.height());
    let largest = w.max(h);
    if largest <= max_dim {
        // Already small enough; never scale up.
        return img.clone();
    }
    // `DynamicImage::resize` preserves aspect ratio (it fits the image inside
    // the given box), so passing `max_dim` for both axes scales the larger
    // side down to `max_dim` and the other proportionally. Triangle (bilinear)
    // is fast and good enough for preview thumbnails; Lanczos3 would be
    // marginally sharper but noticeably slower in single-threaded WASM. Alpha
    // is premultiplied/handled internally to avoid edge bleed.
    img.resize(max_dim, max_dim, image::imageops::FilterType::Triangle)
}

/// Re-encode a [`image::DynamicImage`] as PNG bytes. This normalizes the output
/// format, preserves the alpha channel, and strips EXIF/ICC bloat (the PNG
/// encoder is invoked with defaults and embeds neither by default here).
fn encode_png(img: &image::DynamicImage) -> Result<Vec<u8>, ProcError> {
    let mut buf = Vec::new();
    img.write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)?;
    Ok(buf)
}

/// Sniff format + decode, return natural `(width, height)`.
fn probe_dimensions_inner(bytes: &[u8]) -> Result<(u32, u32), ProcError> {
    let img = load_image(bytes)?;
    Ok((img.width(), img.height()))
}

/// Decode, downscale so the larger dimension == `max_dim` (never upscaling),
/// and return the result re-encoded as PNG bytes.
fn decode_and_downscale_inner(bytes: &[u8], max_dim: u32) -> Result<Vec<u8>, ProcError> {
    let img = load_image(bytes)?;
    let out = downscale(&img, max_dim);
    encode_png(&out)
}

/// Decode, re-encode as PNG, return a `data:image/png;base64,...` URI string.
fn reencode_original_inner(bytes: &[u8]) -> Result<String, ProcError> {
    let img = load_image(bytes)?;
    let png = encode_png(&img)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(format!("data:image/png;base64,{}", b64))
}

// ---------------------------------------------------------------------------
// wasm-bindgen exports (thin wrappers mapping ProcError -> stable code strings)
// ---------------------------------------------------------------------------

/// Install the panic hook so Rust panics surface in the browser console as a
/// readable stack trace instead of a bare `unreachable`. No-op when compiled
/// for a non-wasm target (keeps native `cargo test`/`cargo build` working).
#[wasm_bindgen]
pub fn init_panic_hook() {
    #[cfg(target_arch = "wasm32")]
    console_error_panic_hook::set_once();
}

/// Sniff the image format and return the natural dimensions as a JS array
/// `[width, height]` of numbers. Enforces [`MAX_SOURCE_DIMENSION`].
///
/// # Errors
/// Returns one of: `"unsupported_format"`, `"decode_failed"`,
/// `"dimensions_too_large"`.
#[wasm_bindgen]
pub fn probe_dimensions(bytes: &[u8]) -> Result<js_sys::Array, JsValue> {
    let (w, h) = probe_dimensions_inner(bytes).map_err(|e| JsValue::from_str(e.code()))?;
    let arr = js_sys::Array::new_with_length(2);
    arr.set(0, JsValue::from_f64(w as f64));
    arr.set(1, JsValue::from_f64(h as f64));
    Ok(arr)
}

/// Decode the image, downscale so the larger dimension equals `max_dim` (never
/// upscales beyond 1.0 scale; smaller inputs are returned at original size),
/// preserve alpha, and return the result as PNG bytes. Enforces
/// [`MAX_SOURCE_DIMENSION`] on the natural size.
///
/// # Errors
/// Returns one of: `"unsupported_format"`, `"decode_failed"`,
/// `"dimensions_too_large"`.
#[wasm_bindgen]
pub fn decode_and_downscale(bytes: &[u8], max_dim: u32) -> Result<Vec<u8>, JsValue> {
    decode_and_downscale_inner(bytes, max_dim).map_err(|e| JsValue::from_str(e.code()))
}

/// Re-encode the uploaded image as PNG (format normalized, alpha preserved,
/// EXIF/ICC stripped) and return it as a `data:image/png;base64,...` URI string
/// suitable for embedding directly in the exported SVG.
///
/// # Errors
/// Returns one of: `"unsupported_format"`, `"decode_failed"`,
/// `"dimensions_too_large"`.
#[wasm_bindgen]
pub fn reencode_original(bytes: &[u8]) -> Result<String, JsValue> {
    reencode_original_inner(bytes).map_err(|e| JsValue::from_str(e.code()))
}

// ---------------------------------------------------------------------------
// Tests (native — `cargo test`)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: build a solid-color RGBA PNG of the given size, fully in-test.
    fn make_png(width: u32, height: u32) -> Vec<u8> {
        let img = image::RgbaImage::new(width, height);
        let dyn_img = image::DynamicImage::ImageRgba8(img);
        let mut buf = Vec::new();
        dyn_img
            .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
            .expect("synthetic png should encode");
        buf
    }

    #[test]
    fn probe_dimensions_returns_natural_size() {
        let png = make_png(10, 20);
        let (w, h) = probe_dimensions_inner(&png).expect("10x20 png should probe");
        assert_eq!(w, 10);
        assert_eq!(h, 20);
    }

    #[test]
    fn decode_and_downscale_scales_to_max_dim() {
        let png = make_png(100, 100);
        let out = decode_and_downscale_inner(&png, 50).expect("100x100 -> 50 should succeed");
        let img = image::load_from_memory(&out).expect("output must be a valid image");
        assert_eq!((img.width(), img.height()), (50, 50));
    }

    #[test]
    fn decode_and_downscale_does_not_upscale() {
        let png = make_png(100, 100);
        // max_dim (200) > natural (100): must NOT be upscaled.
        let out = decode_and_downscale_inner(&png, 200).expect("no-upscale path should succeed");
        let img = image::load_from_memory(&out).expect("output must be a valid image");
        assert_eq!((img.width(), img.height()), (100, 100));
    }

    #[test]
    fn decode_and_downscale_preserves_aspect_ratio() {
        let png = make_png(100, 200);
        let out = decode_and_downscale_inner(&png, 50).expect("100x200 -> 50 should succeed");
        let img = image::load_from_memory(&out).expect("output must be a valid image");
        // Larger side == 50, 1:2 aspect -> 25 x 50.
        assert_eq!((img.width(), img.height()), (25, 50));
    }

    #[test]
    fn decode_and_downscale_output_is_png() {
        let png = make_png(64, 32);
        let out = decode_and_downscale_inner(&png, 16).expect("downscale should succeed");
        // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
        assert_eq!(
            &out[..8],
            &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
            "output must be PNG"
        );
    }

    #[test]
    fn reencode_original_returns_data_uri_png() {
        let png = make_png(8, 8);
        let uri = reencode_original_inner(&png).expect("reencode should succeed");
        let prefix = "data:image/png;base64,";
        assert!(uri.starts_with(prefix), "got: {uri}");

        let b64 = &uri[prefix.len()..];
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .expect("embedded base64 must decode");

        // Decoded payload is a valid PNG at the original dimensions.
        let img = image::load_from_memory(&decoded).expect("decoded bytes must be a valid image");
        assert_eq!((img.width(), img.height()), (8, 8));
        assert_eq!(
            &decoded[..8],
            &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
            "decoded payload must start with PNG magic"
        );
    }

    #[test]
    fn reencode_original_preserves_alpha_dimensions() {
        // Build a partly-transparent RGBA image to confirm alpha survives the
        // PNG round-trip through reencode_original.
        let mut rgba = image::RgbaImage::new(5, 5);
        rgba.put_pixel(0, 0, image::Rgba([255, 0, 0, 0])); // fully transparent red
        rgba.put_pixel(1, 0, image::Rgba([0, 255, 0, 200])); // partial alpha
        let dyn_img = image::DynamicImage::ImageRgba8(rgba);
        let mut src = Vec::new();
        dyn_img
            .write_to(&mut Cursor::new(&mut src), image::ImageFormat::Png)
            .unwrap();

        let uri = reencode_original_inner(&src).expect("reencode should succeed");
        let b64 = &uri["data:image/png;base64,".len()..];
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .expect("base64 decode");
        let img = image::load_from_memory(&decoded).expect("decode reencoded");
        let rgba_out = img.to_rgba8();
        assert_eq!((img.width(), img.height()), (5, 5));
        assert_eq!(rgba_out.get_pixel(0, 0), &image::Rgba([255, 0, 0, 0]));
        assert_eq!(rgba_out.get_pixel(1, 0), &image::Rgba([0, 255, 0, 200]));
    }

    #[test]
    fn dimension_check_rejects_oversized() {
        // Exercise the helper directly with a fake large value so we don't have
        // to allocate a >12000px image (which would be slow and memory-heavy).
        assert!(matches!(
            check_dimensions(MAX_SOURCE_DIMENSION + 1, 100),
            Err(ProcError::DimensionsTooLarge)
        ));
        assert!(matches!(
            check_dimensions(100, MAX_SOURCE_DIMENSION + 1),
            Err(ProcError::DimensionsTooLarge)
        ));
        // Exactly at the cap is allowed (boundary is inclusive of MAX_SOURCE_DIMENSION).
        assert!(check_dimensions(MAX_SOURCE_DIMENSION, MAX_SOURCE_DIMENSION).is_ok());
    }

    #[test]
    fn dimensions_too_large_surfaces_stable_code() {
        let err = check_dimensions(MAX_SOURCE_DIMENSION + 1, 1).unwrap_err();
        assert_eq!(err.code(), "dimensions_too_large");
    }

    #[test]
    fn garbage_bytes_yield_unsupported_format() {
        // No known magic bytes -> image crate returns Unsupported -> our code.
        let err = probe_dimensions_inner(b"not an image").unwrap_err();
        assert!(matches!(err, ProcError::UnsupportedFormat));
        assert_eq!(err.code(), "unsupported_format");
    }

    #[test]
    fn truncated_png_yields_decode_failed() {
        // Valid PNG magic but truncated body: sniff succeeds, decode fails.
        let png = make_png(16, 16);
        let mut truncated = png[..16].to_vec(); // header-ish bytes only
        truncated.extend_from_slice(&[0u8; 4]); // junk tail
        let err = probe_dimensions_inner(&truncated).unwrap_err();
        assert!(matches!(err, ProcError::DecodeFailed));
        assert_eq!(err.code(), "decode_failed");
    }

    #[test]
    fn all_error_codes_are_stable_strings() {
        assert_eq!(ProcError::UnsupportedFormat.code(), "unsupported_format");
        assert_eq!(ProcError::DecodeFailed.code(), "decode_failed");
        assert_eq!(ProcError::DimensionsTooLarge.code(), "dimensions_too_large");
    }
}
