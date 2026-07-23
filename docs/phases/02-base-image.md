# Phase 02 — Base image

## Goal

Let a user choose one base image and use its natural dimensions as the SVG composition canvas.

## Work to complete

- Define `Layer`, `CanvasConfig`, and `CompositionState`, including reserved model-only fields (`rotation`, `visible`, and `locked`).
- Create the Zustand composition store with named actions for setting/replacing the base image, selection, and reset foundations.
- Add base-image validation and upload UI.
- Decode the base image with the temporary browser `Image()` path; WASM is deliberately deferred to Phase 07.
- Set the SVG `viewBox`, width, and height from the base image’s natural size and render the base image at `(0, 0)`.
- Make base replacement and the no-base empty state unambiguous.

## Definition of done

- Selecting a supported base image renders it at its native aspect ratio in a live SVG.
- The store is the source of truth for canvas dimensions and base-layer state; the DOM is not used as storage.
- No overlay, drag, resize, or export functionality is required in this phase.

## Verifiable evidence

- Unit tests cover base-image state transitions and reset behavior.
- A source inspection confirms `viewBox="0 0 canvas.width canvas.height"` is driven by state.
- `npm run build` succeeds.

## Manual check

Run `npm run dev`, upload a clearly non-square image as the base, and confirm the SVG canvas adopts its aspect ratio rather than stretching it to the panel.
