import { test, expect } from '@playwright/test'
import { pngFile } from './fixtures'

/**
 * E2E: Phase 06 composition controls — layer list reorder, properties form
 * edits, delete-with-confirm, and reset/clear.
 *
 * Uses the same real-file-upload pattern as drag/resize specs (valid PNG
 * buffers generated in-process via `pngFile`). Selectors target stable
 * `data-testid` attributes added in Phase 06.
 */

/**
 * Upload a base image plus N overlays. Waits for the canvas <svg> to mount
 * (base decoded) and for each overlay's `<g data-role="overlay">` to render.
 */
async function uploadBaseAndOverlays(
  page: import('@playwright/test').Page,
  overlays: { name: string; w: number; h: number }[],
): Promise<void> {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })
  const fileInputs = page.locator('input[type="file"]')
  await fileInputs.nth(0).setInputFiles(pngFile('base.png', 200, 200))
  await page.locator('svg[role="img"]').waitFor()
  await expect(fileInputs.nth(1)).toBeEnabled()
  await fileInputs
    .nth(1)
    .setInputFiles(overlays.map((o) => pngFile(o.name, o.w, o.h)))
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(
    overlays.length,
  )
}

/**
 * Read the paint order of rendered layers straight from the SVG DOM.
 *
 * The canvas renders one element with `data-layer-id` per layer (the base
 * `<image>` directly, each overlay as a wrapping `<g>`) in ascending z-index
 * order — so the returned array IS the back-to-front paint order.
 */
async function svgPaintOrder(
  page: import('@playwright/test').Page,
): Promise<string[]> {
  return page
    .locator('svg [data-layer-id]')
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-layer-id') ?? ''),
    )
}

/** Map each layer's data-layer-id to its displayed filename, from the list. */
async function layerListEntries(
  page: import('@playwright/test').Page,
): Promise<{ id: string; filename: string }[]> {
  return page
    .locator('[data-testid="layer-item"]')
    .evaluateAll((els) =>
      els.map((e) => ({
        id: e.getAttribute('data-layer-id') ?? '',
        // The filename is in the first child span's text.
        filename: e.querySelector('span')?.textContent?.trim() ?? '',
      })),
    )
}

// ---------------------------------------------------------------------------

test('reordering a layer via the list changes SVG paint order', async ({
  page,
}) => {
  await uploadBaseAndOverlays(page, [
    { name: 'a.png', w: 80, h: 80 },
    { name: 'b.png', w: 80, h: 80 },
  ])

  const entries = await layerListEntries(page)
  const idA = entries.find((e) => e.filename.includes('a.png'))!.id
  const idB = entries.find((e) => e.filename.includes('b.png'))!.id
  const baseId = entries.find((e) => e.filename.includes('base.png'))!.id

  const before = await svgPaintOrder(page)
  // Initially: base paints first, then a, then b (b added last -> on top).
  expect(before).toEqual([baseId, idA, idB])

  // The displayed list is descending (topmost first): [b, a, base].
  // The first list item is the topmost overlay (b). Move it DOWN one slot.
  const firstItem = page.locator('[data-testid="layer-item"]').nth(0)
  await firstItem.locator('[data-testid="layer-move-down"]').click()

  const after = await svgPaintOrder(page)
  // b and a swapped paint positions; base stays at the back.
  expect(after).toEqual([baseId, idB, idA])
})

test('editing x in the Properties panel moves the layer', async ({ page }) => {
  await uploadBaseAndOverlays(page, [{ name: 'a.png', w: 80, h: 80 }])

  // Select the overlay via its layer list row.
  const overlayItem = page
    .locator('[data-testid="layer-item"]')
    .filter({ hasText: 'a.png' })
  await overlayItem.click()

  const overlayImage = page.locator('g[data-role="overlay"] image')
  const beforeX = Number(await overlayImage.getAttribute('x'))

  const xInput = page.locator('[data-testid="properties-input-x"]')
  await expect(xInput).toBeVisible()
  await xInput.fill('77')
  // Blur to commit (in case the immediate write-through races the assertion).
  await xInput.blur()

  await expect(overlayImage).toHaveAttribute('x', '77')
  expect(Number(await overlayImage.getAttribute('x'))).not.toBe(beforeX)
})

test('delete confirm: cancel keeps the layer, confirm removes it', async ({
  page,
}) => {
  await uploadBaseAndOverlays(page, [{ name: 'a.png', w: 80, h: 80 }])

  // Initially: base image + 1 overlay image in the SVG.
  await expect(page.locator('svg image')).toHaveCount(2)

  const overlayItem = page
    .locator('[data-testid="layer-item"]')
    .filter({ hasText: 'a.png' })
  await overlayItem.locator('[data-testid="layer-delete"]').click()

  // Confirm dialog appears.
  const dialog = page.locator('[data-testid="confirm-dialog"]')
  await expect(dialog).toBeVisible()

  // Cancel -> dialog closes, layer remains.
  await page.locator('[data-testid="confirm-cancel"]').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('svg image')).toHaveCount(2)

  // Reopen and confirm -> layer removed.
  await overlayItem.locator('[data-testid="layer-delete"]').click()
  await expect(dialog).toBeVisible()
  await page.locator('[data-testid="confirm-confirm"]').click()
  await expect(dialog).toHaveCount(0)

  // Only the base image remains.
  await expect(page.locator('svg image')).toHaveCount(1)
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(0)
})

test('reset/clear confirm empties the composition', async ({ page }) => {
  await uploadBaseAndOverlays(page, [
    { name: 'a.png', w: 80, h: 80 },
    { name: 'b.png', w: 80, h: 80 },
  ])

  // Canvas is live.
  await expect(page.locator('svg[role="img"]')).toBeVisible()
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(2)

  await page.locator('[data-testid="reset-button"]').click()
  const dialog = page.locator('[data-testid="confirm-dialog"]')
  await expect(dialog).toBeVisible()

  await page.locator('[data-testid="confirm-confirm"]').click()
  await expect(dialog).toHaveCount(0)

  // Canvas is gone (no base -> empty placeholder) and the layer list is empty.
  await expect(page.locator('svg[role="img"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="layer-item"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="reset-button"]')).toBeDisabled()
})
