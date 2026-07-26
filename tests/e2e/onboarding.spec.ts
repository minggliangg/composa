import { test, expect } from '@playwright/test'

/**
 * E2E: onboarding walkthrough.
 *
 * Covers the two halves of the feature:
 *   - The TopBar help (?) icon re-opens the walkthrough at any time.
 *   - On a genuine first run (empty localStorage) the dialog opens
 *     automatically.
 *
 * Context setup:
 *   - playwright.config.ts pre-seeds `composa-onboarding-seen=1` for the whole
 *     suite via `storageState`, so every other spec starts as a RETURNING
 *     visitor. The first-run test below overrides `storageState` per-test with
 *     an empty context to simulate a brand-new device.
 *   - The "show again" tests rely on that seeded flag so the dialog doesn't
 *     auto-pop; they then open it explicitly via the help icon.
 */

/** An empty storageState = a fresh, never-seen-onboarding device. */
const EMPTY_STORAGE = {
  cookies: [],
  origins: [
    {
      origin: 'http://localhost:5173',
      localStorage: [],
    },
  ],
}

// ---------------------------------------------------------------------------

test('the help (?) icon opens the walkthrough', async ({ page }) => {
  await page.goto('/')
  // The seeded storageState means it should NOT auto-open.
  await expect(page.getByTestId('onboarding-dialog')).toHaveCount(0)

  await page.getByTestId('onboarding-help').click()

  const dialog = page.getByTestId('onboarding-dialog')
  await expect(dialog).toBeVisible()
  // First step is the Welcome kicker.
  await expect(dialog).toContainText('Welcome')
})

test('Next advances steps and Got it closes the dialog', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('onboarding-help').click()
  const dialog = page.getByTestId('onboarding-dialog')
  await expect(dialog).toBeVisible()

  // Step 1 -> Compose
  await expect(dialog).toContainText('Welcome')
  await page.getByTestId('onboarding-next').click()
  await expect(dialog).toContainText('Compose')

  // Step 2 -> Arrange
  await page.getByTestId('onboarding-next').click()
  await expect(dialog).toContainText('Arrange')

  // Step 3 -> Export
  await page.getByTestId('onboarding-next').click()
  await expect(dialog).toContainText('Export')

  // Last step: the forward button relabels to "Got it" and dismisses.
  await expect(page.getByTestId('onboarding-next')).toHaveText('Got it')
  await page.getByTestId('onboarding-next').click()
  await expect(dialog).toHaveCount(0)
})

test('Back returns to the previous step and is disabled on step 1', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByTestId('onboarding-help').click()

  // On the first step Back is disabled.
  await expect(page.getByTestId('onboarding-back')).toBeDisabled()

  // Advance once, then Back returns to step 1.
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-back')).toBeEnabled()
  await page.getByTestId('onboarding-back').click()
  await expect(page.getByTestId('onboarding-dialog')).toContainText('Welcome')
})

test('Skip (✕) closes the dialog without finishing', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('onboarding-help').click()
  await expect(page.getByTestId('onboarding-dialog')).toBeVisible()

  await page.getByTestId('onboarding-skip').click()
  await expect(page.getByTestId('onboarding-dialog')).toHaveCount(0)
})

test('after dismissing, the help icon re-opens the walkthrough from step 1', async ({
  page,
}) => {
  await page.goto('/')

  // Open, skip, then re-open — it should start at Welcome again, proving the
  // seen flag does not block re-opening and the step counter resets.
  await page.getByTestId('onboarding-help').click()
  await page.getByTestId('onboarding-skip').click()

  await page.getByTestId('onboarding-help').click()
  await expect(page.getByTestId('onboarding-dialog')).toContainText('Welcome')
  // And Back is disabled again (step 1).
  await expect(page.getByTestId('onboarding-back')).toBeDisabled()
})

test('on a genuine first run the walkthrough opens automatically', async ({
  browser,
}) => {
  // Override the suite-wide seeded storageState with an empty one to simulate
  // a device that has never seen onboarding.
  const context = await browser.newContext({ storageState: EMPTY_STORAGE })
  const page = await context.newPage()
  try {
    await page.goto('/')
    // Auto-opens on first run.
    await expect(page.getByTestId('onboarding-dialog')).toBeVisible()
    await expect(page.getByTestId('onboarding-dialog')).toContainText('Welcome')

    // After dismissing, reloading should NOT auto-open again (seen flag set).
    await page.getByTestId('onboarding-skip').click()
    await page.reload()
    await expect(page.getByTestId('onboarding-dialog')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
