import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { setupBaseAndOverlay } from './fixtures'

/**
 * E2E: Slice B — per-asset border.
 *
 * Split into focused tests: toggle + outward geometry + colour; the
 * editor/export anti-drift assertion; a single-toggle undo; and that the base
 * layer shows no border controls.
 */

test('per-asset border: toggle, outward geometry, colour commit/revert', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })
  const { rect } = await setupBaseAndOverlay(page, 400, 400, 200, 150)

  // --- toggle on: exactly one border rect, no vector-effect ---
  await page.locator('[data-testid="properties-border-toggle"]').click()
  const border = page.locator('g[data-role="overlay"] rect[data-role="border"]')
  await expect(border).toHaveCount(1)
  await expect(border).not.toHaveAttribute('vector-effect')

  // --- width 4 + padding 6 -> stroke pushed outward by pad + t/2 ---
  const img = await rect()
  await page.locator('[data-testid="properties-border-width"]').fill('4')
  await page.locator('[data-testid="properties-border-padding"]').fill('6')
  await page.locator('[data-testid="properties-border-padding"]').blur()
  const canvasR = await border.evaluate((el) => ({
    x: Number(el.getAttribute('x')),
    width: Number(el.getAttribute('width')),
    strokeWidth: Number(el.getAttribute('stroke-width')),
  }))
  // path.x = imageX - p - t/2 = imageX - 6 - 2 = imageX - 8
  expect(canvasR.x).toBeCloseTo(img.x - 8, 5)
  expect(canvasR.width).toBeCloseTo(img.width + 16, 5)
  expect(canvasR.strokeWidth).toBe(4)

  // --- hex commit + invalid revert ---
  await page.locator('[data-testid="properties-border-hex"]').fill('#ff0000')
  await page.locator('[data-testid="properties-border-hex"]').blur()
  await expect(border).toHaveAttribute('stroke', '#ff0000')
  await page.locator('[data-testid="properties-border-hex"]').fill('nonsense')
  await page.locator('[data-testid="properties-border-hex"]').blur()
  await expect(border).toHaveAttribute('stroke', '#ff0000') // unchanged
})

test('exported border geometry matches the live canvas (anti-drift)', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })
  await setupBaseAndOverlay(page, 400, 400, 200, 150)

  await page.locator('[data-testid="properties-border-toggle"]').click()
  await page.locator('[data-testid="properties-border-width"]').fill('4')
  await page.locator('[data-testid="properties-border-padding"]').fill('6')
  await page.locator('[data-testid="properties-border-padding"]').blur()
  const border = page.locator('g[data-role="overlay"] rect[data-role="border"]')
  const canvasR = await border.evaluate((el) => ({
    x: Number(el.getAttribute('x')),
    y: Number(el.getAttribute('y')),
    width: Number(el.getAttribute('width')),
    height: Number(el.getAttribute('height')),
    strokeWidth: Number(el.getAttribute('stroke-width')),
  }))

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid="export-button"]').click(),
  ])
  const svg = readFileSync((await download.path())!, 'utf8')
  const facts = await page.evaluate((svgText) => {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    const b = doc.querySelector('rect[data-role="border"]')
    return {
      parseError: doc.querySelector('parsererror') ? true : false,
      borderCount: doc.querySelectorAll('rect[data-role="border"]').length,
      prevSiblingTag: b?.previousElementSibling?.tagName.toLowerCase() ?? null,
      x: b?.getAttribute('x') ?? '',
      y: b?.getAttribute('y') ?? '',
      width: b?.getAttribute('width') ?? '',
      height: b?.getAttribute('height') ?? '',
      strokeWidth: b?.getAttribute('stroke-width') ?? '',
      id: b?.getAttribute('id') ?? '',
    }
  }, svg)

  expect(facts.parseError).toBe(false)
  expect(facts.borderCount).toBe(1)
  expect(facts.prevSiblingTag).toBe('image') // immediately-following sibling
  expect(facts.id.endsWith('-border')).toBe(true)
  // anti-drift: exported geometry === live canvas geometry
  expect(Number(facts.x)).toBeCloseTo(canvasR.x, 5)
  expect(Number(facts.y)).toBeCloseTo(canvasR.y, 5)
  expect(Number(facts.width)).toBeCloseTo(canvasR.width, 5)
  expect(Number(facts.height)).toBeCloseTo(canvasR.height, 5)
  expect(Number(facts.strokeWidth)).toBeCloseTo(canvasR.strokeWidth, 5)
})

test('one undo reverts a single border toggle', async ({ page }) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })
  await setupBaseAndOverlay(page, 400, 400, 200, 150)

  await page.locator('[data-testid="properties-border-toggle"]').click()
  const border = page.locator('g[data-role="overlay"] rect[data-role="border"]')
  await expect(border).toHaveCount(1)

  await page.locator('[data-testid="undo-button"]').click()
  await expect(border).toHaveCount(0)
})

test('the base layer shows no border controls', async ({ page }) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })
  await setupBaseAndOverlay(page, 400, 400, 200, 150)

  // Select the base (the last/bottommost layer-list item).
  await page.locator('[data-testid="layer-item"]').last().click()
  await expect(page.locator('[data-testid="properties-border"]')).toHaveCount(0)
})
