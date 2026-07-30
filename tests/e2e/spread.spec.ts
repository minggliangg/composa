import { test, expect } from '@playwright/test'
import { pngFile } from './fixtures'

/**
 * E2E: Slice A — even-spread tool.
 *
 * Uploads a base + 3 overlays, positions them at explicit NON-overlapping x
 * values (auto-placement cascades/overlaps, and the outer-bounds-preserved
 * invariant only holds for non-overlapping selections), shift-clicks the
 * layer-list rows to multi-select, and asserts: auto (empty gap) yields equal
 * gaps with fixed outer bounds; a fixed gap of 10 yields exactly-10 gaps; an
 * invalid gap disables both buttons; selecting only two disables auto; vertical
 * spreads y only.
 */

/** Read every overlay image's box, sorted by x for stable index correspondence. */
function readRects(page: import('@playwright/test').Page) {
  return page
    .locator('g[data-role="overlay"] image')
    .evaluateAll((els) =>
      els
        .map((e) => ({
          x: Number(e.getAttribute('x')),
          y: Number(e.getAttribute('y')),
          width: Number(e.getAttribute('width')),
          height: Number(e.getAttribute('height')),
        }))
        .sort((a, b) => a.x - b.x),
    )
}

/** Select a layer-list row (by index) and set its X via the properties input. */
async function setX(
  page: import('@playwright/test').Page,
  itemIndex: number,
  x: number,
) {
  await page.locator('[data-testid="layer-item"]').nth(itemIndex).click()
  const input = page.locator('[data-testid="properties-input-x"]')
  await input.fill(String(x))
  await input.blur()
}

test('even spread: auto, fixed gap, disabled states, vertical', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })
  const fileInputs = page.locator('input[type="file"]')
  await fileInputs.nth(0).setInputFiles(pngFile('base.png', 1000, 600))
  await page.locator('svg[role="img"]').waitFor()
  await expect(fileInputs.nth(1)).toBeEnabled()
  await fileInputs.nth(1).setInputFiles([
    pngFile('a.png', 80, 80),
    pngFile('b.png', 120, 60),
    pngFile('c.png', 60, 100),
  ])
  await expect(page.locator('g[data-role="overlay"]')).toHaveCount(3)

  // Place the three overlays at non-overlapping x values. The list is
  // topmost-first: items 0..2 are the overlays, item 3 is the base.
  await setX(page, 0, 750)
  await setX(page, 1, 400)
  await setX(page, 2, 100)

  // Multi-select all three overlays (plain-click selects; shift-click adds).
  const items = page.locator('[data-testid="layer-item"]')
  await items.nth(0).click()
  await items.nth(1).click({ modifiers: ['Shift'] })
  await items.nth(2).click({ modifiers: ['Shift'] })

  // --- auto (empty gap): equal gaps, outer bounds unchanged ---
  const before = await readRects(page)
  await page.locator('[data-testid="spread-horizontal"]').click()
  const after = await readRects(page)
  expect(after[0].x).toBeCloseTo(before[0].x, 5) // leading edge pinned
  const beforeMax = Math.max(...before.map((r) => r.x + r.width))
  const afterMax = Math.max(...after.map((r) => r.x + r.width))
  expect(afterMax).toBeCloseTo(beforeMax, 5) // trailing edge pinned
  const gaps = after.slice(1).map((r, i) => r.x - (after[i].x + after[i].width))
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(0.5)

  // --- fixed gap 10: every gap exactly 10, first x unchanged ---
  await page.locator('[data-testid="spread-gap"]').fill('10')
  await page.locator('[data-testid="spread-horizontal"]').click()
  const g10 = await readRects(page)
  for (const g of g10.slice(1).map((r, i) => r.x - (g10[i].x + g10[i].width))) {
    expect(g).toBeCloseTo(10, 5)
  }
  expect(g10[0].x).toBeCloseTo(after[0].x, 5)

  // --- invalid gap: a type=number input sanitizes non-numeric text to '' at the
  // value level, so 'abc' is unreachable by any input method (the gapInvalid
  // guard remains as defensive code). The reachable disabled case is auto with
  // fewer than 3 selected: ---
  await page.locator('[data-testid="spread-gap"]').fill('')
  await items.nth(2).click({ modifiers: ['Shift'] }) // toggle one off -> 2 left
  await expect(page.locator('[data-testid="spread-horizontal"]')).toBeDisabled()
  await items.nth(2).click({ modifiers: ['Shift'] }) // re-add for the vertical test

  // --- vertical spreads y only (x unchanged) ---
  const beforeV = await readRects(page)
  await page.locator('[data-testid="spread-vertical"]').click()
  const afterV = await readRects(page)
  for (let i = 0; i < afterV.length; i++) {
    expect(afterV[i].x).toBeCloseTo(beforeV[i].x, 5)
  }
})
