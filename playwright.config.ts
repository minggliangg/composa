import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config. Phase 01 only requires the config to exist; the first
 * real E2E tests land in Phase 04+. `playwright test` exits cleanly when no
 * tests match `testDir`, so this does not fail in the scaffold phase.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // Pre-seed the onboarding "seen" flag so every test starts with a context
    // that looks like a RETURNING visitor — otherwise a fresh Playwright context
    // (empty localStorage) is indistinguishable from a genuine first run and the
    // auto-opening OnboardingDialog would intercept every interaction. The
    // dedicated onboarding.spec.ts opts out per-test by clearing this key. This
    // keeps the 6 pre-existing spec files untouched. Origin must match baseURL.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5173',
          localStorage: [{ name: 'composa-onboarding-seen', value: '1' }],
        },
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
