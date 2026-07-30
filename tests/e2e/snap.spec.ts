import { test, expect } from '@playwright/test'
import { setupBaseAndOverlay } from './fixtures'

/**
 * E2E: alignment guides + snap-while-dragging (Step 3/4). Snap is Alt-gated by
 * default (free drag, hold Alt to snap); a status-bar toggle inverts it. These
 * tests use the canvas `<svg>`'s screen rect to map canvas coordinates, since the
 * canvas is fit-to-panel (NOT 1:1) inside the viewport.
 */

/** The overlay's canvas-unit rect, read from the rendered <image> attributes. */
async function rect(page: import('@playwright/test').Page) {
  const img = page.locator('g[data-role="overlay"] image')
  return {
    x: Number(await img.getAttribute('x')),
    y: Number(await img.getAttribute('y')),
    width: Number(await img.getAttribute('width')),
    height: Number(await img.getAttribute('height')),
  }
}

/** Screen-space centre of the canvas (where canvas-unit (cx,cy) maps to at
 *  zoom 1, pan 0 — the state right after a base is loaded). */
async function screenCanvasCenter(page: import('@playwright/test').Page) {
  const b = await page.locator('svg[role="img"]').boundingBox()
  return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 }
}

test('a plain drag shows no snap guides', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await setupBaseAndOverlay(page, 400, 400, 120, 80)

  const img = page.locator('g[data-role="overlay"] image')
  const box = await img.boundingBox()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 60, cy + 40, { steps: 8 })
  await expect(page.getByTestId('snap-guide')).toHaveCount(0)
  await page.mouse.up()
})

test('pressing Alt while holding the layer still shows the guides', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  // The overlay is placed centred on the canvas, so its centre already sits on
  // the canvas centre — pressing Alt (no movement) snaps both axes -> guides.
  await setupBaseAndOverlay(page, 400, 400, 120, 80)

  const img = page.locator('g[data-role="overlay"] image')
  const box = await img.boundingBox()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await expect(page.getByTestId('snap-guide')).toHaveCount(0)
  await page.keyboard.down('Alt')
  // Both centre-x and centre-y land on the canvas centre -> guides appear.
  await expect(page.getByTestId('snap-guide')).not.toHaveCount(0)
  await page.keyboard.up('Alt')
  await page.mouse.up()
})

test('holding Alt snaps the layer centre back to the canvas centre', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await setupBaseAndOverlay(page, 400, 400, 120, 80)

  const img = page.locator('g[data-role="overlay"] image')
  const box = await img.boundingBox()
  const grabX = box!.x + box!.width / 2
  const grabY = box!.y + box!.height / 2
  const center = await screenCanvasCenter(page)

  // 1. Drag the layer OFF centre without snapping.
  await page.mouse.move(grabX, grabY)
  await page.mouse.down()
  await page.mouse.move(grabX - 220, grabY, { steps: 10 })
  const offCenter = await rect(page)
  expect(offCenter.x + offCenter.width / 2).toBeLessThan(180) // clearly off-centre

  // 2. Hold Alt and drag the grab point back onto the canvas centre.
  await page.keyboard.down('Alt')
  await page.mouse.move(center.x, center.y, { steps: 20 })
  await expect(page.getByTestId('snap-guide')).not.toHaveCount(0)
  await page.mouse.up()
  await page.keyboard.up('Alt')

  // The layer's centre snapped onto the canvas centre (200,200) within tolerance.
  const snapped = await rect(page)
  expect(Math.abs(snapped.x + snapped.width / 2 - 200)).toBeLessThan(7)
  expect(Math.abs(snapped.y + snapped.height / 2 - 200)).toBeLessThan(7)
})

test('the status-bar toggle enables snapping without Alt', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await setupBaseAndOverlay(page, 400, 400, 120, 80)

  await page.getByTestId('snap-toggle').click()
  await expect(page.getByTestId('snap-toggle')).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const img = page.locator('g[data-role="overlay"] image')
  const box = await img.boundingBox()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  // A tiny drag keeps the (centred) layer within the snap threshold of the
  // canvas centre -> snap engages on the first pointermove.
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 2, cy + 2, { steps: 6 })
  await expect(page.getByTestId('snap-guide')).not.toHaveCount(0)
  await page.mouse.up()
})
