# Phase 08 — SVG export

## Goal

Export the canonical composition state as one self-contained SVG using full-resolution images.

## Work to complete

- Implement XML attribute escaping and download helpers.
- Implement `buildSvgDocument` from state, never by cloning the live editor DOM.
- Disable export until a base image exists.
- Resolve all layers’ full-resolution data URIs through `reencode_original` in parallel, caching successful per-session results.
- If any layer fails to resolve, fail the export as a whole with a clear error and do not download a partial SVG.
- Emit natural canvas width/height and `viewBox`, metadata, per-layer image elements in z-index order, data-filename attributes, and `data-role="base"` for the base image.
- Ensure the exported SVG contains no selection handles, editor boundary, or preview-resolution URLs.

## Definition of done

- A downloaded SVG is self-contained and opens directly in a browser without access to the original files.
- It visually matches the composition at the base image’s full resolution, including ordering, positions, dimensions, alpha, and standard viewport cropping of off-canvas content.
- Special characters in source filenames are validly XML-escaped in `data-filename`.

## Verifiable evidence

- Unit tests cover `xmlEscapeAttr` and deterministic SVG generation from fixed mock state.
- A Playwright download test parses the resulting SVG XML and checks metadata, layer ordering, embedded data URIs, and escaped filenames.
- `npm run build`, `npx vitest run`, and `npx playwright test` succeed.

## Manual check

Run `npm run dev`, compose a base with a transparent PNG overlay and an image named `photo & friends.png`, export it, then open the downloaded SVG directly in a browser and inspect its source: it should match the arrangement and contain an escaped `data-filename`.
