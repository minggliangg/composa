# Phase 04 — Select and drag

## Goal

Enable reliable layer selection and pointer-driven movement in SVG coordinate space.

## Work to complete

- Implement CTM-based screen-to-canvas conversion using the SVG’s `getScreenCTM()` and `createSVGPoint()`.
- Add click-to-select for image layers and transparent-background click-to-deselect.
- Implement pointer-event dragging with `setPointerCapture`, using pointer-down transform values plus canvas-unit deltas.
- Update transforms through a named store action and render selection feedback for the selected layer.
- Allow off-canvas positions; do not clamp drag coordinates.
- Extract pure movement math for unit testing and use real pointer events for E2E coverage.

## Definition of done

- Dragging changes only the selected layer’s `x`/`y` state and remains aligned with the pointer under SVG scaling or letterboxing.
- Releasing outside the layer or canvas ends the drag cleanly because pointer capture is used.
- A background click reliably clears the selection.

## Verifiable evidence

- Unit tests cover movement-delta math.
- A Playwright test performs a pointer drag against the rendered SVG and asserts the layer transform changes.
- `npm run build` succeeds.

## Manual check

Run `npm run dev`, upload a base and overlay, resize the browser so the canvas is letterboxed, then drag the overlay partly beyond the base boundary; it should follow the pointer and remain selectable.
