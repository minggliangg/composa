# Phase 03 — Overlay upload

## Goal

Add multiple image overlays as visible, non-interactive layers above the base.

## Work to complete

- Add multi-file overlay upload and cheap client-side MIME/extension validation for immediate feedback.
- Extend store actions to add overlays with UUID identities, original filenames, natural dimensions, and dense z-indices above the base.
- Generate deterministic default size and stacked placement for newly added overlays, keeping them within a useful initial viewport where possible.
- Render every layer in ascending z-index order in the live SVG, using the browser decode/preview path until Phase 07.
- Preserve the original filename verbatim in state; duplicate handling is display work deferred to Phase 09.

## Definition of done

- Users can add more than one supported overlay in one operation or repeated operations.
- Every new overlay is visible over the base, and later overlays paint above earlier ones.
- Overlay identity is UUID-based, never filename-based.

## Verifiable evidence

- Unit tests cover adding several overlays and their z-index/order invariants.
- Unsupported client-side file selections show a clear rejection rather than producing a broken layer.
- `bun run build` succeeds.

## Manual check

Run `bun run dev`, upload a base and then three distinct overlay images; all three should be visible, with the last uploaded one visibly on top where they overlap.
