import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { pngFile } from './fixtures'

/**
 * E2E: Phase 08 SVG export round-trip.
 *
 * Uploads a real base image + an overlay whose filename contains XML-special
 * characters (`photo & friends.png`), clicks Export, intercepts the Playwright
 * `download` event, reads the downloaded file off disk, and parses it as XML
 * inside the browser context (which has a real `DOMParser`). Asserts the
 * exported SVG is self-contained and faithful to the composition: metadata
 * present, image count matches layer count, base tagged, ordering correct,
 * the special filename validly XML-escaped, and each href a base64 PNG data URI.
 */
test('exporting produces a self-contained SVG with escaped filenames', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  const fileInputs = page.locator('input[type="file"]')

  // Base image sets the canvas to its natural size (200x200).
  await fileInputs.nth(0).setInputFiles(pngFile('base.png', 200, 200))
  await page.locator('svg[role="img"]').waitFor()
  await expect(fileInputs.nth(1)).toBeEnabled()

  // Overlay with a filename containing every XML-special char of interest.
  await fileInputs
    .nth(1)
    .setInputFiles(pngFile('photo & friends.png', 100, 50))
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(1)

  // Intercept the download triggered by the Export button.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid="export-button"]').click(),
  ])
  expect(download.suggestedFilename()).toBe('composition.svg')

  const path = await download.path()
  expect(path).not.toBeNull()
  const svg = readFileSync(path!, 'utf8')

  // The raw bytes must contain the validly-escaped data-filename (not the bare
  // `&`, which would make the XML ill-formed).
  expect(svg).toContain('data-filename="photo &amp; friends.png"')

  // Parse inside the browser so we get a real DOMParser + XML semantics.
  const facts = await page.evaluate((svgText) => {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    // A parse error would surface as a <parsererror> element.
    const parseError = doc.querySelector('parsererror')
    const root = doc.documentElement
    const meta = doc.querySelector('metadata')
    const images = Array.from(doc.querySelectorAll('image'))
    return {
      parseError: parseError ? parseError.textContent : null,
      rootTag: root.tagName.toLowerCase(),
      width: root.getAttribute('width'),
      height: root.getAttribute('height'),
      viewBox: root.getAttribute('viewBox'),
      metaText: meta?.textContent ?? null,
      imageCount: images.length,
      roles: images.map((i) => i.getAttribute('data-role')),
      filenames: images.map((i) => i.getAttribute('data-filename')),
      hrefs: images.map((i) => i.getAttribute('href') ?? ''),
    }
  }, svg)

  // Well-formed XML (no parser errors).
  expect(facts.parseError).toBeNull()
  expect(facts.rootTag).toBe('svg')

  // Canvas adopts the base image's natural size.
  expect(facts.width).toBe('200')
  expect(facts.height).toBe('200')
  expect(facts.viewBox).toBe('0 0 200 200')

  // Metadata block carries the structured fields.
  expect(facts.metaText).not.toBeNull()
  const meta = JSON.parse(facts.metaText!)
  expect(meta.appName).toBe('composa.')
  expect(meta.appVersion).toBe('0.1.0')
  expect(typeof meta.exportedAt).toBe('string')
  expect(meta.canvasWidth).toBe(200)
  expect(meta.canvasHeight).toBe(200)
  expect(meta.layerCount).toBe(2)

  // One <image> per layer; base first (ascending z-index).
  expect(facts.imageCount).toBe(2)
  expect(facts.roles[0]).toBe('base')
  expect(facts.roles[1]).toBeNull()

  // The XML parser un-escapes the attribute back to the original filename.
  expect(facts.filenames[0]).toBe('base.png')
  expect(facts.filenames[1]).toBe('photo & friends.png')

  // Every href is a base64 PNG data URI (full-res bytes embedded).
  for (const href of facts.hrefs) {
    expect(href.startsWith('data:image/png;base64,')).toBe(true)
    // And it is non-empty beyond the prefix.
    expect(href.length).toBeGreaterThan('data:image/png;base64,'.length)
  }
})
