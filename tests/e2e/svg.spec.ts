import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { svgFile } from './fixtures'

/**
 * E2E: SVG import + export (the "fancy fox" plan, Phase 1 + 3).
 *
 * SVG bypasses WASM entirely, so this round-trips vector fidelity: upload an
 * SVG base + an SVG overlay, confirm both render, then export and confirm the
 * downloaded file embeds them as nested `<svg>` bodies (NOT rasterized
 * `<image href="data:…">`).
 */

const BASE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
  '<rect width="200" height="200" fill="#3b82f6"/></svg>'

const OVERLAY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
  '<defs><linearGradient id="g"><stop stop-color="#ef4444"/></linearGradient></defs>' +
  '<circle cx="40" cy="40" r="40" fill="url(#g)"/></svg>'

test('SVG base + overlay upload, render, and export as nested <svg>', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  const fileInputs = page.locator('input[type="file"]')

  // SVG base sets the canvas to its intrinsic 200x200.
  await fileInputs.nth(0).setInputFiles(svgFile('base.svg', BASE_SVG))
  await page.locator('svg[role="img"]').waitFor()
  await expect(fileInputs.nth(1)).toBeEnabled()

  // SVG overlay.
  await fileInputs.nth(1).setInputFiles(svgFile('overlay.svg', OVERLAY_SVG))
  await expect(page.locator('g[data-role="overlay"] image')).toHaveCount(1)

  // Export and intercept the download.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid="export-button"]').click(),
  ])
  expect(download.suggestedFilename()).toBe('composition.svg')

  const svg = readFileSync((await download.path())!, 'utf8')

  // Vector fidelity: the base + overlay are nested <svg> bodies, not embedded
  // raster images. So there must be at least one nested <svg and NO
  // <image href="data: rasterization.
  expect(/<svg [^>]*viewBox=/.test(svg)).toBe(true)
  expect(svg).not.toContain('<image href="data:')

  // Well-formed XML, valid when parsed in the browser.
  const facts = await page.evaluate((svgText) => {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    return {
      parseError: doc.querySelector('parsererror') ? true : false,
      nestedSvgs: doc.querySelectorAll('svg > svg').length,
      images: doc.querySelectorAll('image').length,
    }
  }, svg)
  expect(facts.parseError).toBe(false)
  expect(facts.nestedSvgs).toBe(2) // base + overlay
  expect(facts.images).toBe(0)
})

test('two copies of the same gradient SVG export without colliding ids', async ({
  page,
}) => {
  // The id-collision case Phase 3 exists to handle: the SAME logo (with a
  // gradient id) uploaded twice. Export must namespace both so neither breaks.
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  const fileInputs = page.locator('input[type="file"]')
  await fileInputs.nth(0).setInputFiles(svgFile('base.svg', BASE_SVG))
  await page.locator('svg[role="img"]').waitFor()
  await expect(fileInputs.nth(1)).toBeEnabled()
  // Upload the SAME gradient SVG twice.
  await fileInputs.nth(1).setInputFiles([
    svgFile('logo-1.svg', OVERLAY_SVG),
    svgFile('logo-2.svg', OVERLAY_SVG),
  ])
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(2)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid="export-button"]').click(),
  ])
  const svg = readFileSync((await download.path())!, 'utf8')

  // Both copies' gradient ids are namespaced distinctly (L1__g and L2__g), and
  // each references its own — no bare `id="g"` collision.
  expect(svg).toContain('id="L1__g"')
  expect(svg).toContain('id="L2__g"')
  expect(svg).not.toMatch(/\bid="g"/)
  expect(svg).toContain('url(#L1__g)')
  expect(svg).toContain('url(#L2__g)')

  // And the whole document parses cleanly.
  const ok = await page.evaluate((svgText) => {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    return !doc.querySelector('parsererror')
  }, svg)
  expect(ok).toBe(true)
})
