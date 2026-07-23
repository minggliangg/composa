import { test, expect } from '@playwright/test'
import { setupBaseAndOverlay } from './fixtures'

/**
 * E2E: a real pointer drag against the rendered SVG moves the overlay.
 *
 * The app uploads via `setInputFiles` (real file inputs, valid PNG buffers
 * generated in-process), so no test hooks are needed. Assertions read the
 * overlay `<image>`'s `x`/`y` attributes (canvas units) before and after a
 * Playwright mouse drag.
 */
test('dragging an overlay changes its x/y', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { overlayImage, rect } = await setupBaseAndOverlay(
    page,
    200,
    200,
    100,
    50,
  )

  const before = await rect()
  const box = await overlayImage.boundingBox()
  expect(box).not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  // Drag down-right by 40px / 30px. The SVG renders ~1:1 (canvas units == CSS
  // px here), so the canvas-unit delta should be roughly the same magnitude.
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 40, cy + 30, { steps: 6 })
  await page.mouse.up()

  const after = await rect()
  expect(after.x).toBeGreaterThan(before.x)
  expect(after.y).toBeGreaterThan(before.y)
  // Clearly moved (not just a sub-pixel jitter).
  expect(after.x - before.x).toBeGreaterThan(20)
  expect(after.y - before.y).toBeGreaterThan(10)
})

test('clicking empty canvas deselects the overlay (no handles)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { overlayImage } = await setupBaseAndOverlay(page, 200, 200, 100, 50)

  // Overlay is auto-selected on upload -> handles are present.
  await expect(page.locator('[data-handle="se"]')).toBeVisible()

  // Click the overlay (selects it, no move).
  const box = await overlayImage.boundingBox()
  await page.mouse.move(box!.x + 5, box!.y + 5)
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.locator('[data-handle="se"]')).toBeVisible()

  // Click on empty canvas area (the non-interactive base lets the click fall
  // through to the background <rect> -> deselects).
  const svgBox = await page.locator('svg[role="img"]').boundingBox()
  // A point near the top-left corner of the SVG, away from the centered overlay.
  const emptyX = svgBox!.x + 8
  const emptyY = svgBox!.y + 8
  await page.mouse.move(emptyX, emptyY)
  await page.mouse.down()
  await page.mouse.up()

  await expect(page.locator('[data-handle="se"]')).toHaveCount(0)
})
