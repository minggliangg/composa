# composa. — Undo/Redo & Aspect-Ratio Restore: Implementation Plan

## Context

This plan consolidates the editor-history work discussed across the save-status,
undo, and aspect-ratio conversations. The overarching theme: **composa has no
persistence layer**, so the UI must make "what state am I in, and can I get back?"
legible without nagging. Three pieces serve that goal:

1. **Save-status indicator** — replace the redundant unsaved-changes badge + banner
   + always-on subtitle with a single calm signal. ✅ **Shipped** (see "Status"
   below).
2. **Undo/redo** — time-travel over composition mutations (drags, resizes, adds,
   deletes, reorders, align/distribute, opacity). 🚧 Planned.
3. **Revert layer(s) to original aspect ratio** — un-distort one or many layers
   back to the source image's intrinsic ratio. 🚧 Planned.

The store was deliberately built as a single mutation seam with this work in
mind — `compositionStore.ts:9` says: *"Centralized named actions keep a clean
seam for a future undo middleware (undo/redo itself is out of scope for MVP)."*
This plan picks that up.

## Status

| Piece                         | Status      | Notes                                                                                       |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| Save-status indicator         | ✅ Shipped   | Wordmark period = the dot; see `src/panels/TopBar.tsx` + `src/index.css` (`composa-status-pulse`). |
| Export clears `isDirty`       | ✅ Shipped   | `markClean()` action; called on successful export.                                          |
| Undo/redo (history)           | 🚧 Planned   | Feature A below.                                                                            |
| Revert to original aspect     | 🚧 Planned   | Feature B below.                                                                            |

## Decisions locked in

| Area                         | Decision                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| History mechanism            | `zundo` `temporal` middleware (`/charkour/zundo`, High reputation, zustand-v5-compatible). Confirmed API: `partialize`, `equality`, `limit`, `diff`. |
| What history tracks          | `{ canvas, layers }` (and `isDirty` — see open decision D1). Excludes `selectedLayerIds` (selection is not history).                                  |
| History bound                | `limit: 50`. Snapshots share `File`/dataURI refs by reference, so memory stays small even with full-res sources.                                      |
| Gesture coalescing           | One drag/resize = one undo step, via zundo `pause()`/`resume()` bracketing the pointer gesture.                                                       |
| Save-status indicator visual | Amber pulsing period when dirty, slate when clean, custom hover/focus tooltip. ✅ Shipped.                                                            |
| Undo triggers                | ⌘Z / ⌘⇧Z (and ⌘Y) globally + Undo/Redo buttons in the TopBar, disabled when history is empty.                                                        |
| Aspect-revert data source    | Each layer's immutable `naturalWidth`/`naturalHeight` (`types/layer.ts:43-46`) — already present, no new capture needed.                              |
| Aspect-revert seam           | New `resetLayersAspect(ids)` action routed through existing `updateLayersTransform` (auto half-pixel snap + one undo step once history lands).        |

### Open decisions (need your call before/during build)

- **D1 — Is `isDirty` tracked in history?**
  - *Option a (recommended, simplest):* exclude `isDirty`. The dot is "sticky
    true" once you edit; `Export`/`Reset` still clear it. Undo does not touch the
    dot. Downside: undoing *all the way back* to an empty canvas leaves the dot
    pulsing (edge case).
  - *Option b (more correct):* track `isDirty`. Undo/redo restores the exact
    dirty bit at each snapshot. Downside: `markClean()` (export) becomes an
    undoable step — undoing past an export re-dirties the dot, which is odd.
- **D2 — Aspect-revert anchor:** when restoring the ratio, which dimension do we
  hold? (See Feature B §Anchor.)

---

## Feature A — Undo/Redo

### A.1 Approach

Wrap the existing Zustand store in zundo's `temporal` middleware. Every existing
action already funnels through `set()`, so no action bodies change — only the
store's creation site and a small amount of gesture plumbing.

```ts
// src/state/compositionStore.ts  (creation site only)
import { temporal } from 'zundo'
import { useTemporalStore } from 'zundo' // verify exact export name at build time

export const useCompositionStore = create<CompositionStore>()(
  temporal(
    (set, get) => ({
      ...initialState,
      // …all existing actions unchanged…
    }),
    {
      // Track the composition, not the selection. (D1 decides whether isDirty
      // is included here.)
      partialize: (state) => {
        const { selectedLayerIds, ...tracked } = state
        return tracked
      },
      equality: shallowEqual,      // skip no-op snapshots
      limit: 50,
    },
  ),
)
```

> **Verify at build time:** the exact names of the temporal-store hook
> (`useTemporalStore`) and its `pause`/`resume`/`pastStates`/`futureStates`
> surface against current zundo docs (`bunx ctx7@latest docs /charkour/zundo
> "pause resume pastStates futureStates useTemporalStore"`). The `partialize` /
> `equality` / `limit` shape above is confirmed.

### A.2 Gesture coalescing — the part that must feel right

Drags and resizes write to the store on **every pointer move** today
(`useCanvasPointer.ts:124` `updateLayersTransform(...)`, `ResizeHandle.tsx:88`).
If each micro-write became a history entry, undo would be unusable (dozens of
steps per gesture). Collapse each gesture to one entry by bracketing it with
zundo's `pause()` / `resume()`:

```ts
// src/canvas/useCanvasPointer.ts
const onPointerDown = useCallback((e) => {
  // …existing selection + snapshot logic…
  if (movers.length === 0) return
  useTemporalStore.getState().pause()          // ← begin gesture (no entries while paused)
  e.currentTarget.setPointerCapture(e.pointerId)
}, …)

const endDrag = useCallback((e) => {
  // …existing cleanup…
  useTemporalStore.getState().resume()         // ← end gesture (net change = one entry)
}, [])
```

Apply the identical bracketing to `ResizeHandle.tsx` (`onPointerDown` → `pause`,
`endResize` → `resume`). Discrete actions (add/delete/reorder/align/opacity/
aspect-reset) need **no** bracketing — they're already single writes, so each is
naturally one undo step.

### A.3 UX wiring

- **Keyboard:** a single `useEffect` in `App.tsx` (or `TopBar.tsx`) registers a
  `keydown` listener: `⌘Z` → undo, `⌘⇧Z` / `⌘Y` → redo; `preventDefault` to keep
  the browser's own undo out of the way. Ignore when focus is in a text/number
  input (so typing in `PropertiesForm` fields isn't intercepted).
- **Buttons:** add **Undo** / **Redo** to the TopBar control cluster (near
  Export/Reset). Bind `disabled` to `pastStates.length === 0` /
  `futureStates.length === 0` via `useTemporalStore`. Match the existing button
  styling (`ToolButton`-like, focus ring, `title` tooltip).
- **Disabled-vs-empty semantics:** with nothing to undo, the button is disabled
  and its tooltip reads "Nothing to undo."

### A.4 `isDirty` interaction (ties into the shipped indicator)

Depends on D1. Whichever option is chosen, the *shipped* behaviors stay correct:
`Export` → `markClean()` (dot goes quiet), `Reset` → clears everything including
dirty. If D1 = (a), no extra work; if D1 = (b), `isDirty` simply rides along in
the tracked slice.

### A.5 Files touched

| File                                  | Change                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/state/compositionStore.ts`       | Wrap `create()` in `temporal(...)` with `partialize`/`equality`/`limit`. Add a `shallowEqual` helper if not present. |
| `src/canvas/useCanvasPointer.ts`      | `pause()` in `onPointerDown`, `resume()` in `endDrag`.                                    |
| `src/canvas/ResizeHandle.tsx`         | `pause()` in `onPointerDown`, `resume()` in `endResize`.                                  |
| `src/panels/TopBar.tsx`               | Undo/Redo buttons (disabled state from temporal store).                                   |
| `src/App.tsx` (or `TopBar.tsx`)       | Global ⌘Z / ⌘⇧Z / ⌘Y keydown handler, input-aware.                                        |
| `package.json`                        | `bun add zundo` (zustand v5 peer already satisfied).                                      |
| `tests/unit/compositionStore.test.ts` | History round-trip + coalescing tests.                                                    |
| `tests/e2e/` (new spec)               | ⌘Z undoes a drag; buttons disable at history edges.                                       |

### A.6 Build sequence

1. `bun add zundo`; wrap the store; confirm app still boots and existing 168 tests
   pass (no history wired into UI yet).
2. Add Undo/Redo buttons reading the temporal store; manually verify discrete
   actions (add → undo removes the layer, etc.).
3. Add gesture bracketing (pause/resume) in the two pointer hooks; verify a drag
   is exactly one undo step.
4. Add the keyboard shortcut + input-focus guard.
5. Resolve D1; add unit + e2e tests.

### A.7 Risks / notes

- **zundo pause/resume semantics:** confirm that a paused-then-resumed run
  records the *net* change as one entry (not zero, not many). If zundo's
  semantics differ, fall back to a commit-only pattern (write to a draft during
  the gesture, commit once on pointer-up) — more refactor, but deterministic.
- **Selection exclusion:** because `selectedLayerIds` is not tracked, undo
  restores geometry but leaves the current selection intact (desired — undo
  shouldn't yank your selection around).
- **`reorderLayer` / `deleteLayer`:** already single writes; undo restores array
  order and revives deleted layers. Note `deleteLayer` revokes the preview object
  URL (`compositionStore.ts:176`) — an undone delete must not dereference a stale
  URL. Confirm the revived layer's `previewUrl` is still valid (object URL
  revocation is irreversible; if this bites, defer revocation to a
  history-trim/`clear()` hook).

---

## Feature B — Revert layer(s) to original aspect ratio

### B.1 Why it's cheap

Every `Layer` already stores immutable `naturalWidth` / `naturalHeight`
(`types/layer.ts:43-46`) — the source image's true ratio — alongside the mutable
`width` / `height`. Restoring the aspect is pure arithmetic over fields that
already exist.

**Useful finding:** drag-resize *already preserves* aspect ratio
(`resize.ts:81-96` derives height from the natural aspect on corner handles).
So a layer can only become **distorted** through the `PropertiesForm` numeric W/H
fields. "Revert aspect" therefore mainly undoes typed distortions and doubles as
a quick "reset fit."

### B.2 The action

```ts
// src/state/compositionStore.ts
/** Revert one or more layers to their source aspect ratio, holding the current
 *  width and re-anchoring so the center stays put. Routed through the shared
 *  transform seam → automatic half-pixel snap + one undo step (once history lands). */
resetLayersAspect: (ids: string[]) =>
  get().updateLayersTransform(
    get()
      .layers.filter((l) => ids.includes(l.id) && l.naturalWidth > 0 && l.naturalHeight > 0)
      .map((l) => {
        const ratio = l.naturalWidth / l.naturalHeight
        const height = l.width / ratio          // hold width, derive height
        const y = l.y + (l.height - height) / 2 // keep vertical center fixed
        return { id: l.id, patch: { height, y } }
      }),
  ),
```

Add `resetLayersAspect` to the `CompositionStore` interface. Multi-select "just
works" — each layer uses its own `naturalWidth`/`naturalHeight`.

### B.3 Anchor (open decision D2)

The snippet above holds **width** and recenters on **y**. Alternatives:

- *Keep width (recommended):* predictable; width is the axis users reason about.
- *Keep height:* derive `width = height * ratio`, recenter on `x`.
- *Keep bounding box (area):* scale so `width * height` is preserved — most
  "size-stable" but least obvious to the user.

Recommend **keep width + center anchor** unless you prefer otherwise.

### B.4 UI placement

- **Single layer:** a "Reset aspect" button in `PropertiesForm` (near the W/H
  fields), enabled when the layer's current ratio ≠ natural ratio (so it's inert
  when already correct).
- **Multi-select:** a new group in `AlignmentToolbar` ("Reset" / "Aspect"),
  reusing its `Group`/`ToolButton` pattern (`min={1}`). Writes through the same
  `resetLayersAspect` action. Disabled for the base image (base is always at
  natural size; align toolbar already filters it out).

### B.5 Files touched

| File                                       | Change                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/state/compositionStore.ts`            | Add `resetLayersAspect(ids)` action + interface entry.                                |
| `src/panels/RightPanel/PropertiesForm.tsx` | "Reset aspect" button (single layer), enabled only when ratio differs.                |
| `src/panels/RightPanel/AlignmentToolbar.tsx` | New "Aspect" group with a `Reset aspect` button (multi-select).                     |
| `tests/unit/compositionStore.test.ts`      | Aspect-restore math: distorted layer → natural ratio; center anchor; multi-select.   |
| `tests/e2e/` (new or existing spec)        | Button restores a distorted layer's ratio.                                            |

### B.6 Build sequence

1. Add `resetLayersAspect` + unit tests for the math (anchor choice baked in per D2).
2. Wire the `PropertiesForm` single-layer button.
3. Wire the `AlignmentToolbar` multi-select group.
4. (Once Feature A lands) verify it registers as a single undo step.

---

## Recommended build order

1. **Feature B (aspect restore)** — small, self-contained, ships user value
   immediately and exercises the `updateLayersTransform` seam that Feature A
   depends on.
2. **Feature A (undo/redo)** — larger; lands the history layer that subsequent
   features (including B's single-step undo) benefit from.

Resolve **D1** and **D2** before starting the corresponding build step.
