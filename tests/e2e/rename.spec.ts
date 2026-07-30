import { test, expect } from '@playwright/test'
import { setupBaseAndOverlay } from './fixtures'

/**
 * E2E: layer renaming (Step 1). Run on a machine with a C toolchain. Renames a
 * layer in-place in the list, and checks the rename also shows in the properties
 * panel and the delete-confirm copy, and that undo restores the old name.
 */

test('double-click a layer row to rename it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await setupBaseAndOverlay(page, 200, 200, 100, 50)

  // The overlay row's label shows the original filename initially.
  const row = page.locator('[data-testid="layer-item"]').first()
  await expect(row).toContainText('overlay.png')

  // Double-click the label to enter edit mode.
  await row.locator('span').first().dblclick()
  const input = page.getByTestId('layer-rename-input')
  await expect(input).toBeVisible()

  // Type a new name and commit with Enter.
  await input.fill('Hero Logo')
  await input.press('Enter')

  // The list now shows the new name.
  await expect(row).toContainText('Hero Logo')
  // The properties panel's Name field shows it too.
  await expect(page.getByTestId('properties-name')).toHaveValue('Hero Logo')
})

test('Escape cancels an in-progress rename', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await setupBaseAndOverlay(page, 200, 200, 100, 50)
  const row = page.locator('[data-testid="layer-item"]').first()

  await row.locator('span').first().dblclick()
  const input = page.getByTestId('layer-rename-input')
  await input.fill('Discarded')
  await input.press('Escape')

  // The original name is restored (rename was cancelled).
  await expect(row).toContainText('overlay.png')
  await expect(page.getByTestId('layer-rename-input')).toHaveCount(0)
})

test('the delete-confirm copy uses the display label', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await setupBaseAndOverlay(page, 200, 200, 100, 50)
  const row = page.locator('[data-testid="layer-item"]').first()

  await row.locator('span').first().dblclick()
  await page.getByTestId('layer-rename-input').fill('Branded')
  await page.getByTestId('layer-rename-input').press('Enter')

  // Open the delete confirm; it should quote the renamed label.
  await row.getByTestId('layer-delete').click()
  await expect(page.getByRole('alertdialog')).toContainText('Branded')
})

test('undo restores the previous name', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await setupBaseAndOverlay(page, 200, 200, 100, 50)
  const row = page.locator('[data-testid="layer-item"]').first()

  await row.locator('span').first().dblclick()
  await page.getByTestId('layer-rename-input').fill('Renamed')
  await page.getByTestId('layer-rename-input').press('Enter')
  await expect(row).toContainText('Renamed')

  // Undo via the keyboard (the TopBar undo handler bails on editable targets,
  // so we click outside the field first).
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')

  await expect(row).toContainText('overlay.png')
})
