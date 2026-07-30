import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * E2E: blank base templates (the "fancy fox" plan, Phase 2).
 *
 * Clicking a preset creates a synthetic blank base — no upload, no WASM. The
 * canvas adopts the chosen 1:1 size, the boundary rect + status bar reflect
 * it, and export emits a literal white `<rect>`.
 */

test('a blank 2048 canvas sets the canvas size and exports as a white <rect>', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.locator('[data-testid="blank-base-2048"]').click()
  await page.locator('svg[role="img"]').waitFor()

  // The boundary rect is the full 2048x2048 canvas.
  const boundary = page.locator('[data-testid="canvas-boundary"]')
  await expect(boundary).toHaveAttribute('width', '2048')
  await expect(boundary).toHaveAttribute('height', '2048')

  // The status bar reports the canvas dimensions.
  await expect(page.locator('[data-testid="status-bar"]')).toContainText(
    '2048×2048',
  )

  // Export -> a literal solid white rect (not an embedded image).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid="export-button"]').click(),
  ])
  const svg = readFileSync((await download.path())!, 'utf8')
  expect(svg).toContain('fill="#ffffff"')
  expect(svg).not.toContain('<image')

  // And it is tagged as the base role + carries the blank filename.
  const ok = await page.evaluate((svgText) => {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    if (doc.querySelector('parsererror')) return false
    const rect = doc.querySelector('rect')
    return (
      !!rect &&
      rect.getAttribute('data-role') === 'base' &&
      rect.getAttribute('data-filename') === 'blank-2048.svg' &&
      rect.getAttribute('fill') === '#ffffff'
    )
  }, svg)
  expect(ok).toBe(true)
})

test('replacing an existing base with a blank canvas asks for confirmation', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  // Start with a 512 blank canvas.
  await page.locator('[data-testid="blank-base-512"]').click()
  await page.locator('svg[role="img"]').waitFor()
  await expect(page.locator('[data-testid="status-bar"]')).toContainText('512×512')

  // Replacing with 1024 opens the confirm dialog (base already exists).
  await page.locator('[data-testid="blank-base-1024"]').click()
  await expect(page.locator('[data-testid="confirm-dialog"]')).toBeVisible()
  await page.locator('[data-testid="confirm-confirm"]').click()

  // Canvas adopted the new size.
  await expect(page.locator('[data-testid="canvas-boundary"]')).toHaveAttribute(
    'width',
    '1024',
  )
  await expect(page.locator('[data-testid="status-bar"]')).toContainText(
    '1024×1024',
  )
})
