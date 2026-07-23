# Phase 07 — WASM image processing

## Goal

Replace the temporary browser image pipeline with Rust/WASM image decoding and downscaled previews running in a Web Worker.

## Work to complete

- Add the `image-processor` Rust `cdylib`, `wasm-bindgen` exports, pinned image-format features, and `scripts/build-wasm.sh`.
- Install and wire `wasm-pack`; configure Vite for the web-targeted generated module and top-level await where required.
- Implement `init_panic_hook`, magic-byte-based dimension probing, `decode_and_downscale`, and `reencode_original` with short stable error codes.
- Enforce `MAX_SOURCE_DIMENSION` in probe/decode paths.
- Implement the Worker’s separate WASM initialization and typed main-thread proxy; WASM instances must not be transferred across threads.
- Replace the live image previews with Worker-produced downscaled PNG object URLs, while retaining the original `File` for eventual full-resolution export.
- Map Worker/WASM errors to clear user-facing upload messages. Treat animated GIFs as first-frame-only and document it in UI/help text if exposed.

## Definition of done

- The app’s live SVG renders only generated preview URLs, and intensive decode/downscale work does not execute on the UI thread.
- Corrupt, unsupported, and over-dimension inputs fail safely with application-level messages.
- The production build runs `wasm-pack build` before Vite and succeeds from a clean generated-package state.

## Verifiable evidence

- `npm run build` generates the WASM package and completes Vite’s production build.
- Rust-side tests (where applicable) and JS tests validate stable error-code mapping and Worker proxy behavior.
- Browser DevTools shows Worker activity during upload; the main thread remains responsive while processing a large valid image.

## Manual check

Run `npm run dev`, upload a large valid image, and immediately interact with the page while it processes; the page should remain responsive and the finished image should appear as a preview. Then try an unsupported file and confirm a readable error.
