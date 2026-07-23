import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { pngFile, transparentPngFile } from './fixtures'

/**
 * Phase 09 — transparent PNG fidelity (MVP plan §7 "Transparent PNG overlays").
 *
 * Alpha must survive the whole pipeline: WASM decode + downscale (preview) AND
 * `reencode_original` (full-res bytes embedded in the exported SVG). The codec
 * level is covered by the Rust unit test `reencode_original_preserves_alpha`;
 * this E2E exercises the full upload -> export round-trip and asserts the
 * exported overlay's embedded PNG still carries an alpha channel (PNG color
 * type 6 = truecolor + alpha).
 *
 * Parsing is done Node-side off the downloaded SVG bytes (robust + no in-page
 * serialization). PNG IHDR color type lives at byte offset 25.
 */

/** Pull every embedded PNG data URI out of the exported SVG, in document order. */
function embeddedPngHrefs(svg: string): string[] {
  return [...svg.matchAll(/href="(data:image\/png;base64,[^"]+)"/g)].map(
    (m) => m[1],
  )
}

test('a transparent PNG overlay keeps its alpha channel through export', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  const fileInputs = page.locator('input[type="file"]')

  // Opaque base sets the canvas.
  await fileInputs.nth(0).setInputFiles(pngFile('base.png', 120, 120))
  await page.locator('svg[role="img"]').waitFor()
  await expect(fileInputs.nth(1)).toBeEnabled()

  // Overlay with a real alpha channel (pixel 0,0 fully transparent).
  await fileInputs
    .nth(1)
    .setInputFiles(transparentPngFile('overlay.png', 60, 60))
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(1)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid="export-button"]').click(),
  ])
  expect(download.suggestedFilename()).toBe('composition.svg')

  const path = await download.path()
  expect(path).not.toBeNull()
  const svg = readFileSync(path!, 'utf8')

  // Base (z=0) is emitted first, so the overlay is the SECOND data URI.
  const hrefs = embeddedPngHrefs(svg)
  expect(hrefs.length).toBe(2)
  const overlayHref = hrefs[1]

  const bytes = Buffer.from(
    overlayHref.slice('data:image/png;base64,'.length),
    'base64',
  )
  // Sanity: real PNG signature first byte.
  expect(bytes[0]).toBe(0x89)
  // PNG color type lives at byte 25 (sig=8 + len=4 + type=4 + W=4 + H=4 + bitDepth=1).
  // Color type 6 == truecolor + alpha (RGBA). If alpha were stripped it would be 2.
  expect(bytes[25]).toBe(6)
})
