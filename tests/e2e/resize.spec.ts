import { test, expect } from '@playwright/test'
import { setupBaseAndOverlay } from './fixtures'

/**
 * E2E: resize the overlay through a corner handle (aspect ratio preserved) and
 * an edge handle (only one dimension changes). Uses real pointer events on the
 * rendered SVG; assertions read the overlay `<image>`'s width/height attributes.
 */

test('corner handle preserves aspect ratio', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { rect } = await setupBaseAndOverlay(page, 200, 200, 100, 50)

  const before = await rect()
  // natural aspect 100:50 == 2:1, and placement preserves it.
  const ratioBefore = before.width / before.height

  const handle = page.locator('[data-handle="se"]')
  await expect(handle).toBeVisible()
  const hb = await handle.boundingBox()
  const hx = hb!.x + hb!.width / 2
  const hy = hb!.y + hb!.height / 2

  // Drag the SE corner outward (down-right).
  await page.mouse.move(hx, hy)
  await page.mouse.down()
  await page.mouse.move(hx + 30, hy + 30, { steps: 6 })
  await page.mouse.up()

  const after = await rect()
  expect(after.width).toBeGreaterThan(before.width)
  expect(after.height).toBeGreaterThan(before.height)
  // Aspect ratio is preserved exactly by the corner math.
  expect(after.width / after.height).toBeCloseTo(ratioBefore, 5)
})

test('edge handle changes only one dimension', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const { rect } = await setupBaseAndOverlay(page, 200, 200, 100, 50)

  const before = await rect()

  const handle = page.locator('[data-handle="e"]')
  await expect(handle).toBeVisible()
  const hb = await handle.boundingBox()
  const hx = hb!.x + hb!.width / 2
  const hy = hb!.y + hb!.height / 2

  // Drag the east edge outward (right) — only width should change.
  await page.mouse.move(hx, hy)
  await page.mouse.down()
  await page.mouse.move(hx + 40, hy, { steps: 6 })
  await page.mouse.up()

  const after = await rect()
  expect(after.width).toBeGreaterThan(before.width)
  expect(after.height).toBeCloseTo(before.height, 5)
})
