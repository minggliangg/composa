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
