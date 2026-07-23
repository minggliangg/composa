# Phase 05 — Resize handles

## Goal

Provide all eight selection handles with the locked MVP resize rules.

## Work to complete

- Render a selection overlay and eight accessible pointer targets around the selected layer.
- Implement corner resize anchored at the opposite corner, preserving the layer’s natural aspect ratio.
- Implement edge resize as one-axis free resize.
- Enforce a documented `MIN_LAYER_SIZE` and prevent invalid negative dimensions.
- Route all resulting transform changes through the same store action used by drag and future properties inputs.
- Extract resize calculations into pure functions and cover each handle direction, aspect-ratio behavior, and minimum-size floor with table-driven tests.

## Definition of done

- All four corners resize proportionally, and all four edges resize only their corresponding dimension.
- Handle interactions retain pointer capture and work when the canvas is visually scaled.
- Resizing does not change layer order, corrupt dimensions, or create negative width/height.

## Verifiable evidence

- Unit tests cover every handle and minimum-size behavior.
- A Playwright test resizes a layer through at least one corner and one edge.
- `npm run build` succeeds.

## Manual check

Run `npm run dev`, select an overlay, drag a corner handle and verify its proportions stay fixed; then drag a side handle and verify only width or height changes.
