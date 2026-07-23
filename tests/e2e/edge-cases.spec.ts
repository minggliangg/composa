import { test, expect } from '@playwright/test'
import { pngFile } from './fixtures'

/**
 * Phase 09 E2E — two more rows of the MVP plan §7 edge-case table:
 *   - "Duplicate filenames": the layer list shows dedup'd `(n)` labels while the
 *     stored filename stays verbatim.
 *   - "Overlays dragged off-canvas": the editor renders a dashed export-crop
 *     boundary, the editor <svg> does not clip (overflow=visible), and overlay
 *     coordinates are NOT clamped to the canvas.
 */

/** Read each layer-list row's displayed filename text, top-to-bottom. */
async function listLabels(
  page: import('@playwright/test').Page,
): Promise<string[]> {
  return page
    .locator('[data-testid="layer-item"]')
    .evaluateAll((els) =>
      els.map((e) => e.querySelector('span')?.textContent?.trim() ?? ''),
    )
}

// --- duplicate filenames --------------------------------------------------

test('two overlays with the same filename get deduped (n) display labels', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  const fileInputs = page.locator('input[type="file"]')
  await fileInputs.nth(0).setInputFiles(pngFile('base.png', 200, 200))
  await page.locator('svg[role="img"]').waitFor()
  await expect(fileInputs.nth(1)).toBeEnabled()

  // Upload TWO overlays that share the exact same filename.
  await fileInputs.nth(1).setInputFiles([
    pngFile('dup.png', 60, 60),
    pngFile('dup.png', 60, 60),
  ])
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(2)

  const labels = await listLabels(page)
  // Exactly two rows mention "dup", and the collision is disambiguated: one
  // keeps the bare name, the other gets the " (1)" suffix before the extension.
  const dupLabels = labels.filter((l) => l.includes('dup'))
  expect(dupLabels).toHaveLength(2)
  expect(dupLabels).toContain('dup.png')
  expect(dupLabels).toContain('dup (1).png')
})

// --- off-canvas boundary + unclamped coordinates --------------------------

test('editor shows a dashed canvas boundary, does not clip, and keeps off-canvas coords', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  const fileInputs = page.locator('input[type="file"]')
  await fileInputs.nth(0).setInputFiles(pngFile('base.png', 200, 200))
  await page.locator('svg[role="img"]').waitFor()
  await expect(fileInputs.nth(1)).toBeEnabled()
  await fileInputs.nth(1).setInputFiles(pngFile('overlay.png', 80, 80))
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(1)

  const svg = page.locator('svg[role="img"]')

  // EDITOR-ONLY dashed boundary rect outlines the canvas (export-crop edge).
  const boundary = svg.locator('[data-editor-only="boundary"]')
  await expect(boundary).toHaveCount(1)
  await expect(boundary).toHaveAttribute('width', '200')
  await expect(boundary).toHaveAttribute('height', '200')
  // pointerEvents none so it never intercepts canvas interaction.
  await expect(boundary).toHaveAttribute('pointer-events', 'none')

  // The editor <svg> does NOT clip off-canvas content (plan §4).
  await expect(svg).toHaveAttribute('overflow', 'visible')

  // Select the overlay and push it past the right edge of the 200px canvas.
  await page
    .locator('[data-testid="layer-item"]')
    .filter({ hasText: 'overlay.png' })
    .click()
  const xInput = page.locator('[data-testid="properties-input-x"]')
  await xInput.fill('250') // > canvas width (200) -> fully off the right edge
  await xInput.blur()

  // The overlay's x is NOT clamped back inside the canvas.
  const overlayImage = page.locator('g[data-role="overlay"] image')
  await expect(overlayImage).toHaveAttribute('x', '250')
})
