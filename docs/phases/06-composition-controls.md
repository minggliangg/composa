# Phase 06 — Composition controls

## Goal

Finish the non-WASM editor loop: users can inspect, reorder, edit, delete, reset, and clear a composition.

## Work to complete

- Build the layer list with selection, original-filename display, and drag-to-reorder controls.
- Renumber z-indices densely whenever the user reorders layers; retain base image at z-index 0.
- Add deletion with confirmation and clear/reset actions backed by the shared confirmation dialog.
- Build a properties panel with read-only filename plus numeric `x`, `y`, `width`, and `height` inputs.
- Make form edits call the same transform action as canvas drag/resize.
- Add the top-bar controls and prepare `isDirty` state, while the refresh warning itself belongs to Phase 09.

## Definition of done

- The layer list, canvas, and properties panel always agree on selection, position, size, and order.
- Destructive actions require confirmation and leave a valid state.
- This is a complete editor workflow except for WASM processing, export, and hardening work.

## Verifiable evidence

- Unit tests cover select, delete, reorder, reset, and numeric transform updates.
- An E2E test confirms reordering changes visible SVG paint order and property edits move/resize the corresponding layer.
- `bun run test`, `bun run test:e2e`, and `bun run build` succeed.

## Manual check

Run `bun run dev`, add two overlapping overlays, move the lower one above the other in the layer list, edit its `x` value in Properties, then delete it and cancel the confirmation once before confirming it.
