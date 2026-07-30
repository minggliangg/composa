import { test, expect } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { svgFile } from './fixtures'

/**
 * E2E: viewport zoom + pan (the "fancy fox" plan, Phase 4).
 *
 * Uses a BLANK base + an SVG overlay — both WASM-free — so the test runs without
 * the image worker. The coordinate regression it proves is medium-independent:
 * drag/resize land on the correct CANVAS units at any zoom iff `getScreenCTM()`
 * folds in the viewport's CSS `transform: scale()`. (The plan's variant used a
 * PNG base; a vector overlay exercises the identical pointer math.)
 */

const OVERLAY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">' +
  '<rect width="120" height="120" fill="#22c55e"/></svg>'

async function overlayRect(locator: Locator) {
  return {
    x: Number(await locator.getAttribute('x')),
    y: Number(await locator.getAttribute('y')),
    width: Number(await locator.getAttribute('width')),
    height: Number(await locator.getAttribute('height')),
  }
}

test('zoom buttons move the readout; fit restores it; pan shifts; drag stays on-grid at zoom', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 800 })

  // Blank base (no WASM) + an SVG overlay (no WASM).
  await page.locator('[data-testid="blank-base-1024"]').click()
  await page.locator('svg[role="img"]').waitFor()
  await page.locator('input[type="file"]').nth(1).setInputFiles(svgFile('ovl.svg', OVERLAY_SVG))
  const overlayImage = page.locator('g[data-role="overlay"] image')
  await overlayImage.waitFor()

  const readout = () =>
    page.locator('[data-testid="zoom-readout"]').textContent()

  // --- zoom buttons move the readout up; fit brings it back --------------
  const fitPct = Number((await readout())!.replace('%', ''))
  for (let i = 0; i < 4; i++) await page.locator('[data-testid="zoom-in"]').click()
  const zoomedPct = Number((await readout())!.replace('%', ''))
  expect(zoomedPct).toBeGreaterThan(fitPct + 20)

  await page.locator('[data-testid="zoom-fit"]').click()
  const restoredPct = Number((await readout())!.replace('%', ''))
  expect(Math.abs(restoredPct - fitPct)).toBeLessThanOrEqual(1)

  // --- pan shifts the viewport (screen), but not the layer's canvas x/y --
  // Zoom in a bit first so panning is observable, then middle-drag.
  for (let i = 0; i < 2; i++) await page.locator('[data-testid="zoom-in"]').click()
  const box = await overlayImage.boundingBox()
  const beforeAttr = await overlayRect(overlayImage)
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + 30, { steps: 6 })
  await page.mouse.up({ button: 'middle' })
  // The overlay's screen position moved (the viewport panned)...
  const boxAfterPan = await overlayImage.boundingBox()
  expect(boxAfterPan!.x).toBeGreaterThan(box!.x + 20)
  // ...but its CANVAS position is unchanged (pan is not a layer edit).
  const afterPanAttr = await overlayRect(overlayImage)
  expect(afterPanAttr.x).toBe(beforeAttr.x)
  expect(afterPanAttr.y).toBe(beforeAttr.y)

  // Reset pan/zoom for a clean drag measurement.
  await page.locator('[data-testid="zoom-fit"]').click()

  // --- drag lands on correct canvas coordinates at zoom != fit ----------
  // The regression: at zoom>fit a screen drag must still move the layer by
  // (screenDelta / effectiveScale) canvas units. effectiveScale is derived from
  // the rendered overlay: screen-px-per-canvas-unit = bbox.width / attr.width.
  for (let i = 0; i < 3; i++) await page.locator('[data-testid="zoom-in"]').click()
  await overlayImage.scrollIntoViewIfNeeded().catch(() => {})
  const zBox = await overlayImage.boundingBox()
  const zAttr = await overlayRect(overlayImage)
  const effectiveScale = zBox!.width / zAttr.width // screen px per canvas unit
  expect(effectiveScale).toBeGreaterThan(0)

  const cx = zBox!.x + zBox!.width / 2
  const cy = zBox!.y + zBox!.height / 2
  const dragDx = 50
  const dragDy = 40
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + dragDx, cy + dragDy, { steps: 8 })
  await page.mouse.up()

  const draggedAttr = await overlayRect(overlayImage)
  const canvasDx = draggedAttr.x - zAttr.x
  const canvasDy = draggedAttr.y - zAttr.y
  // canvas delta ≈ screen delta / effectiveScale. Verify the implied scale
  // matches the measured effectiveScale (i.e. the transform was accounted for,
  // not ignored — which would make impliedScale == fitScale instead).
  expect(canvasDx).toBeGreaterThan(5)
  expect(canvasDy).toBeGreaterThan(5)
  const impliedScaleX = dragDx / canvasDx
  const impliedScaleY = dragDy / canvasDy
  expect(Math.abs(impliedScaleX - effectiveScale) / effectiveScale).toBeLessThan(0.12)
  expect(Math.abs(impliedScaleY - effectiveScale) / effectiveScale).toBeLessThan(0.12)
})
