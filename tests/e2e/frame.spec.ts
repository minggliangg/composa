import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { pngFile } from './fixtures'

/**
 * E2E: Slice C — frame the selection.
 *
 * Uploads a base + 2 overlays, selects both, frames them with padding 12, and
 * asserts: the frame overlay encloses both with a 12-unit gap; the frame is
 * selected; clicking a framed overlay through the frame's transparent interior
 * still selects that overlay (the hit-testing regression guard); and the export
 * emits the frame as a transparent <rect> plus its border.
 */

test('frame the selection: enclosure, selection, click-through, export', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })
  const fileInputs = page.locator('input[type="file"]')
  await fileInputs.nth(0).setInputFiles(pngFile('base.png', 400, 400))
  await page.locator('svg[role="img"]').waitFor()
  await expect(fileInputs.nth(1)).toBeEnabled()
  await fileInputs.nth(1).setInputFiles([
    pngFile('a.png', 80, 80),
    pngFile('b.png', 120, 60),
  ])
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(2)

  // Select both overlays.
  const items = page.locator('[data-testid="layer-item"]')
  await items.nth(0).click()
  await items.nth(1).click({ modifiers: ['Shift'] })

  // Frame with padding 12.
  await page.locator('[data-testid="frame-padding"]').fill('12')
  await page.locator('[data-testid="frame-selection"]').click()

  // A third overlay <g> now exists, carrying a border rect.
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(3)
  const frameBorder = page.locator('g[data-role="overlay"] rect[data-role="border"]').last()
  await expect(frameBorder).toHaveCount(1)

  // The frame border sits 12 units outside the overlays' bbox.
  const { overlays, frame } = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('g[data-role="overlay"] image')).map(
      (e) => ({
        x: Number((e as SVGImageElement).getAttribute('x')),
        y: Number((e as SVGImageElement).getAttribute('y')),
        width: Number((e as SVGImageElement).getAttribute('width')),
        height: Number((e as SVGImageElement).getAttribute('height')),
      }),
    )
    // The frame's <g> has no <image>; its border rect is the last border rect.
    const borders = Array.from(
      document.querySelectorAll('g[data-role="overlay"] rect[data-role="border"]'),
    )
    const fb = borders[borders.length - 1]
    return {
      overlays: imgs,
      frame: fb
        ? {
            x: Number(fb.getAttribute('x')),
            y: Number(fb.getAttribute('y')),
            width: Number(fb.getAttribute('width')),
            height: Number(fb.getAttribute('height')),
            strokeWidth: Number(fb.getAttribute('stroke-width')),
          }
        : null,
    }
  })
  const minX = Math.min(...overlays.map((o) => o.x))
  const minY = Math.min(...overlays.map((o) => o.y))
  const maxX = Math.max(...overlays.map((o) => o.x + o.width))
  const maxY = Math.max(...overlays.map((o) => o.y + o.height))
  // The frame border encloses both overlays.
  expect(frame!.x).toBeLessThanOrEqual(minX)
  expect(frame!.x + frame!.width).toBeGreaterThanOrEqual(maxX)
  // Inner edge (x + strokeWidth/2) is 12 units outside the bbox.
  expect(frame!.x + frame!.strokeWidth / 2).toBeCloseTo(minX - 12, 5)
  expect(frame!.y + frame!.strokeWidth / 2).toBeCloseTo(minY - 12, 5)

  // The frame is selected (its filename shows in the properties panel).
  await expect(page.locator('[data-testid="properties-filename"]')).toHaveText('Frame')

  // Click-through: clicking a framed overlay's interior selects that overlay,
  // not the frame (the transparent frame lets clicks fall through). Target the
  // TOPMOST overlay (the only one not covered by a sibling) and use a coordinate
  // click so the browser routes it via elementFromPoint — the frame's fill rect
  // is pointer-events:none, so the click lands on the overlay below it.
  const topImage = page.locator('g[data-role="overlay"] image').last()
  const box = await topImage.boundingBox()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  // The frame's filename was showing; now an overlay is selected instead.
  await expect(page.locator('[data-testid="properties-filename"]')).not.toHaveText('Frame')

  // Export: the frame emits a transparent <rect> + its border; parses cleanly.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid="export-button"]').click(),
  ])
  const svg = readFileSync((await download.path())!, 'utf8')
  const facts = await page.evaluate((svgText) => {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    const frameRect = doc.querySelector('rect[data-filename="Frame"]')
    return {
      parseError: doc.querySelector('parsererror') ? true : false,
      layerCount: JSON.parse(doc.querySelector('metadata')!.textContent ?? '{}')
        .layerCount,
      frameFill: frameRect?.getAttribute('fill') ?? null,
      borderCount: doc.querySelectorAll('rect[data-role="border"]').length,
    }
  }, svg)
  expect(facts.parseError).toBe(false)
  expect(facts.layerCount).toBe(4)
  expect(facts.frameFill).toBe('none')
  expect(facts.borderCount).toBeGreaterThanOrEqual(1)
})
