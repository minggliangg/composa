# Phase 09 — Edge-case hardening

## Goal

Close the documented MVP edge cases and make data-loss and error behavior clear to users.

## Work to complete

- Add the persistent unsaved-work banner and `beforeunload` warning driven by `isDirty`.
- Implement duplicate filename display labels with deterministic `(n)` suffixes while retaining verbatim original filenames in state and export metadata.
- Add the dashed base-boundary presentation for off-canvas layers without clamping editor coordinates or exporting the boundary.
- Verify transparent PNG preview and export fidelity.
- Exercise file validation against deceptive MIME/extension cases, corrupt data, unsupported formats, and maximum-dimension violations.
- Verify deletion/reset/clear confirmations, no-base export protection, and all rows in the implementation plan’s edge-case table.
- Complete the final regression suite and document any known browser limitations such as browser-controlled unload-dialog wording.

## Definition of done

- Every edge-case row in the MVP plan has a passing automated test, an explicit manual result, or a documented browser limitation with its mitigation.
- User-facing copy accurately says that refresh loses work and no persistence exists in MVP.
- The release build and complete test suite pass, with no editor-only UI leaking into exports.

## Verifiable evidence

- Unit and E2E suites cover filename deduplication, validation/error mapping, export guards, and destructive-action confirmation paths.
- A final edge-case checklist records results for transparency, off-canvas clipping, duplicate display, refresh warning, special-character export, and large-image responsiveness.
- `npm run build`, `npx vitest run`, and `npx playwright test` all succeed.

## Manual check

Run `npm run dev`, make a change and refresh/close the tab to confirm the browser warning; then repeat with duplicate-named overlays and an off-canvas overlay, export the result, and verify that the boundary is absent while the SVG viewport crops the off-canvas content.
