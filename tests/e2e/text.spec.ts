import { test, expect } from '@playwright/test'
import { pngFile } from './fixtures'
import { ADVANCE_RATIO } from '../../src/text/textMetrics'

/**
 * E2E: text layers (Step 7/8). Run on a machine with a C toolchain
 * (`bunx playwright install-deps`). Uploads a real PNG base, adds a text layer
 * via the Add text button, and exercises the styling controls + drag/resize.
 */

async function setupBase(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page
    .locator('input[type="file"]')
    .nth(0)
    .setInputFiles(pngFile('base.png', 400, 400))
  await page.locator('svg[role="img"]').waitFor()
}

test('Add text creates an editable text layer', async ({ page }) => {
  await setupBase(page)

  await page.getByTestId('add-text').click()

  // The text layer renders as a nested <svg> with a <text>/<tspan>.
  const textEl = page.locator('g[data-role="overlay"] svg text')
  await expect(textEl).toBeVisible()
  // Seed content is "Text".
  await expect(textEl.locator('tspan')).toHaveText('Text')

  // The text styling controls are shown.
  await expect(page.getByTestId('properties-text-content')).toBeVisible()
})

test('typing multi-line content lays out one tspan per line', async ({ page }) => {
  await setupBase(page)
  await page.getByTestId('add-text').click()

  const textarea = page.getByTestId('properties-text-content')
  await textarea.fill('Hello\nWorld')

  // Two lines -> two tspans.
  await expect(page.locator('g[data-role="overlay"] svg text tspan')).toHaveCount(2)
})

test('font size / weight / italic / fill / alignment write through', async ({
  page,
}) => {
  await setupBase(page)
  await page.getByTestId('add-text').click()
  await page.getByTestId('properties-text-content').fill('Aa')

  // Font size.
  await page.getByTestId('properties-font-size').fill('64')
  await expect(page.locator('g[data-role="overlay"] svg text')).toHaveAttribute(
    'font-size',
    '64',
  )

  // Weight.
  await page.getByTestId('properties-font-weight').selectOption('700')
  await expect(page.locator('g[data-role="overlay"] svg text')).toHaveAttribute(
    'font-weight',
    '700',
  )

  // Italic toggle.
  await page.getByTestId('properties-italic').click()
  await expect(page.locator('g[data-role="overlay"] svg text')).toHaveAttribute(
    'font-style',
    'italic',
  )

  // Fill colour via the color input.
  await page.getByTestId('properties-fill-color').fill('#ff0000')
  await expect(page.locator('g[data-role="overlay"] svg text')).toHaveAttribute(
    'fill',
    '#ff0000',
  )

  // Alignment -> text-anchor.
  await page.getByTestId('properties-align-center').click()
  await expect(page.locator('g[data-role="overlay"] svg text')).toHaveAttribute(
    'text-anchor',
    'middle',
  )
})

test('dragging a text layer moves it', async ({ page }) => {
  await setupBase(page)
  await page.getByTestId('add-text').click()

  const layer = page.locator('g[data-role="overlay"] svg')
  const box = await layer.boundingBox()
  expect(box).not.toBeNull()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2

  const xBefore = Number(await layer.getAttribute('x'))
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 50, cy + 40, { steps: 6 })
  await page.mouse.up()

  const xAfter = Number(await layer.getAttribute('x'))
  expect(xAfter).toBeGreaterThan(xBefore)
})

test('reset to original size is disabled at natural size', async ({ page }) => {
  await setupBase(page)
  await page.getByTestId('add-text').click()
  // A freshly added text layer renders at its natural size -> reset is inert.
  await expect(page.getByTestId('properties-reset-size')).toBeDisabled()
})

/**
 * Runtime check that the hardcoded ADVANCE_RATIO still matches the shipped font.
 * A fontsource version bump that changed the metrics would fail this; canvas and
 * export share the constant so a mismatch only affects box tightness, but pinning
 * it keeps the box honest. Tolerant to 0.5%.
 */
test('ADVANCE_RATIO matches the measured font advance within 0.5%', async ({
  page,
}) => {
  await setupBase(page)
  await page.getByTestId('add-text').click()
  // Wait for the variable font to load.
  await page.waitForFunction(async () => {
    try {
      await (document as Document).fonts.load('400 64px "Atkinson Hyperlegible Mono Variable"')
      return true
    } catch {
      return false
    }
  })
  const measured = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.font = '64px "Atkinson Hyperlegible Mono Variable"'
    return ctx.measureText('M'.repeat(100)).width / (100 * 64)
  })
  expect(Math.abs(measured - ADVANCE_RATIO)).toBeLessThan(ADVANCE_RATIO * 0.005)
})
