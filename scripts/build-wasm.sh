#!/usr/bin/env bash
# Builds the image-processor WASM module for the composa. web app.
# Output goes to src/wasm/pkg (git-ignored, generated). Wired into `npm run build` in Phase 07.
set -euo pipefail

wasm-pack build crates/image-processor --target web --release --out-dir ../../src/wasm/pkg
