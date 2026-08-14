import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { transparentPngFile } from './fixtures'

/**
 * Transparent blank base + WebP/JSON export.
 *
 * Three end-to-end contracts:
 *   1. The TRANSPARENT blank base paints nothing (checkerboard backdrop in
 *      the editor) and its alpha survives BOTH exports: the SVG path emits
 *      `fill="none"`, and the raster path produces a real WebP with an alpha
 *      channel (RIFF container, ALPH chunk).
 *   2. The WebP export downloads a PAIR — composition.webp +
 *      composition.json — where the manifest's layer geometry matches the
 *      composition (canvas units == image pixels).
 *   3. A white blank base can be flipped to transparent (and back) from the
 *      properties panel, live.
 *
 * Parsing is Node-side off the downloaded bytes (the established pattern —
 * see transparent.spec.ts for the byte-offset precedent).
 */

test('transparent blank base exports a WebP with alpha + a matching JSON manifest', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  // Create a TRANSPARENT blank 512 base: pick the fill, then the size.
  await page.locator('[data-testid="blank-fill-transparent"]').click()
  await page.locator('[data-testid="blank-base-512"]').click()
  await page.locator('svg[role="img"]').waitFor()

  // The editor backdrop switches from solid white to the checkerboard.
  const backdrop = page.locator('[data-testid="canvas-backdrop"]')
  await expect(backdrop).toHaveAttribute('data-transparent', 'true')
  await expect(backdrop).toHaveAttribute('fill', 'url(#composa-checker)')

  // One overlay (real alpha channel) stacked on the transparent base.
  const fileInputs = page.locator('input[type="file"]')
  await fileInputs
    .nth(1)
    .setInputFiles(transparentPngFile('overlay.png', 60, 60))
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(1)

  // Export the PAIR. The image waiter predicate-filters by filename (with two
  // bare waiters, both would resolve on the FIRST download event). The app
  // downloads the image first; the manifest rides along directly while the
  // click's transient activation is live (Playwright's fast 512px chain),
  // otherwise via the one-click follow-up button (test 3 pins that path).
  const [imageDownload] = await Promise.all([
    page.waitForEvent('download', (d) =>
      /\.(webp|png)$/.test(d.suggestedFilename()),
    ),
    page.locator('[data-testid="export-webp-button"]').click(),
  ])
  expect(imageDownload.suggestedFilename()).toBe('composition.webp')

  // Register the json waiter BEFORE possibly clicking the follow-up button.
  const jsonDownloadPromise = page.waitForEvent('download', (d) =>
    d.suggestedFilename().endsWith('.json'),
  )
  const followUp = page.locator('[data-testid="download-manifest"]')
  if (await followUp.waitFor({ timeout: 3000 }).then(
    () => true,
    () => false,
  )) {
    await followUp.click()
  }
  const jsonDownload = await jsonDownloadPromise
  expect(jsonDownload.suggestedFilename()).toBe('composition.json')

  // --- the image: a real WebP container WITH an alpha channel ---------------
  const imagePath = await imageDownload.path()
  expect(imagePath).not.toBeNull()
  const bytes = readFileSync(imagePath!)
  // RIFF header: bytes 0-3 'RIFF', bytes 8-11 'WEBP'.
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
  // The transparent base means most pixels are fully transparent, so the
  // encoder must have written an alpha section. (Chunk fourccs are ASCII.)
  expect(bytes.toString('latin1')).toContain('ALPH')

  // --- the manifest: geometry in image pixels -------------------------------
  const jsonPath = await jsonDownload.path()
  const manifest = JSON.parse(readFileSync(jsonPath!, 'utf8'))

  expect(manifest.format).toBe('composa.manifest/1')
  expect(manifest.canvas).toEqual({ width: 512, height: 512 })
  expect(manifest.image).toEqual({
    filename: 'composition.webp',
    mimeType: 'image/webp',
    width: 512,
    height: 512,
  })

  // Two layers, ascending z-index: the transparent blank base, then the
  // overlay (computeOverlayPlacement at index 0 on a 512 canvas: long side
  // 0.45*512 = 230.4, centered at 140.8 — half-pixel-snapped by the store).
  expect(manifest.layers).toHaveLength(2)
  const [base, overlay] = manifest.layers
  expect(base).toMatchObject({
    kind: 'blank',
    fill: null,
    isBase: true,
    zIndex: 0,
    x: 0,
    y: 0,
    width: 512,
    height: 512,
  })
  expect(base.filename).toBe('blank-512.svg')
  expect(overlay).toMatchObject({
    kind: 'raster',
    filename: 'overlay.png',
    isBase: false,
    zIndex: 1,
    opacity: 1,
  })
  expect(overlay.x).toBeCloseTo(140.8, 0)
  expect(overlay.y).toBeCloseTo(140.8, 0)
  expect(overlay.width).toBeCloseTo(230.4, 0)
  expect(overlay.height).toBeCloseTo(230.4, 0)
})

test('a white blank base flips to transparent (and back) from the properties panel', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  // White blank base (the default fill choice).
  await page.locator('[data-testid="blank-base-512"]').click()
  await page.locator('svg[role="img"]').waitFor()

  // The base is selected on creation, so the properties form shows it; the
  // backdrop starts solid white.
  const backdrop = page.locator('[data-testid="canvas-backdrop"]')
  await expect(backdrop).not.toHaveAttribute('data-transparent', 'true')

  // Flip to transparent.
  await page.locator('[data-testid="base-fill-transparent"]').click()
  await expect(backdrop).toHaveAttribute('data-transparent', 'true')

  // The SVG export of the transparent base paints nothing (fill="none").
  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid="export-button"]').click(),
  ])
  expect(svgDownload.suggestedFilename()).toBe('composition.svg')
  const svg = readFileSync((await svgDownload.path())!, 'utf8')
  expect(svg).toContain('fill="none"')
  expect(svg).not.toContain('fill="#ffffff"')

  // And back to white.
  await page.locator('[data-testid="base-fill-white"]').click()
  await expect(backdrop).not.toHaveAttribute('data-transparent', 'true')
})

test('when the browser gates the second automatic download, a one-click manifest button completes the pair', async ({
  page,
}) => {
  // Simulate an EXPIRED transient activation (the state after a slow
  // re-encode/rasterize chain): the export code must then NOT fire the second
  // anchor click — which Chrome would gate behind the "download multiple
  // files" prompt, silently swallowing composition.json when blocked — and
  // instead surface an explicit follow-up button.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userActivation', {
      value: { hasBeenActive: true, isActive: false },
      configurable: true,
    })
  })
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.locator('[data-testid="blank-base-512"]').click()
  await page.locator('svg[role="img"]').waitFor()

  // Only the image downloads from the export click itself.
  const [imageDownload] = await Promise.all([
    page.waitForEvent('download', (d) =>
      /\.(webp|png)$/.test(d.suggestedFilename()),
    ),
    page.locator('[data-testid="export-webp-button"]').click(),
  ])
  expect(imageDownload.suggestedFilename()).toBe('composition.webp')

  // The manifest was held back: the follow-up button appears…
  const followUp = page.locator('[data-testid="download-manifest"]')
  await expect(followUp).toBeVisible()
  await expect(page.locator('[data-testid="export-note"]')).toBeVisible()

  // …and its (gesture-backed) click completes the pair. The waiter is
  // registered BEFORE the click.
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download', (d) =>
      d.suggestedFilename().endsWith('.json'),
    ),
    followUp.click(),
  ])
  expect(jsonDownload.suggestedFilename()).toBe('composition.json')

  const manifest = JSON.parse(
    readFileSync((await jsonDownload.path())!, 'utf8'),
  )
  expect(manifest.canvas).toEqual({ width: 512, height: 512 })
  expect(manifest.layers).toHaveLength(1)

  // The button clears once the manifest is delivered.
  await expect(followUp).toHaveCount(0)
})
