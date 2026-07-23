# composa. MVP phases

These documents turn the locked MVP plan into sequential, verifiable delivery gates. Complete phases in numerical order: each manual check assumes the preceding phase is working.

| Phase | Outcome |
| --- | --- |
| [01 — Scaffold](01-scaffold.md) | A runnable React/Vite/Tailwind shell with the intended layout. |
| [02 — Base image](02-base-image.md) | A base image establishes an SVG composition canvas. |
| [03 — Overlay upload](03-overlay-upload.md) | Multiple overlays appear in deterministic default positions. |
| [04 — Select and drag](04-select-and-drag.md) | Layers can be selected and moved in SVG canvas units. |
| [05 — Resize handles](05-resize-handles.md) | Selected overlays resize with the specified corner and edge behavior. |
| [06 — Composition controls](06-composition-controls.md) | Layer management and numeric properties complete the editor loop. |
| [07 — WASM image processing](07-wasm-image-processing.md) | Worker-hosted Rust/WASM provides safe preview processing. |
| [08 — SVG export](08-svg-export.md) | The composition exports as a self-contained, faithful SVG. |
| [09 — Hardening](09-edge-case-hardening.md) | MVP edge cases and user-protection behavior are covered. |

Do not treat a phase as complete solely because its UI appears to work. Record the specified automated evidence and perform its manual check.
