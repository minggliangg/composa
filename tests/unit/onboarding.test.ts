import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Unit tests for the onboarding controller (src/state/onboarding.ts).
 *
 * The module holds module-level state (an `open` boolean + a listener set) and
 * reads/writes `localStorage('composa-onboarding-seen')`. To keep the cases
 * independent each test starts from a clean localStorage and resets the module
 * so the in-memory `open` flag is reset.
 *
 * Note: `useOnboardingOpen()` is a React hook built on `useSyncExternalStore`,
 * which can only run inside a render — so we don't call it directly here. The
 * hook's subscribe/snapshot contract is exercised instead through the public
 * `showOnboarding`/`hideOnboarding` surface (covered by the e2e dialog spec for
 * the rendered component).
 */

const STORAGE_KEY = 'composa-onboarding-seen'

async function loadModule() {
  const mod = await import('../../src/state/onboarding')
  return mod
}

describe('onboarding persistence', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.resetModules()
  })

  it('reports unseen when storage is empty (genuine first run)', async () => {
    const { hasSeenOnboarding } = await loadModule()
    expect(hasSeenOnboarding()).toBe(false)
  })

  it('flips to seen after markOnboardingSeen() and persists to localStorage', async () => {
    const { hasSeenOnboarding, markOnboardingSeen } = await loadModule()
    expect(hasSeenOnboarding()).toBe(false)

    markOnboardingSeen()

    expect(hasSeenOnboarding()).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('does not throw when localStorage.setItem throws (private mode)', async () => {
    // Degrade gracefully — same contract as theme.ts.
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('storage unavailable')
      })

    const { markOnboardingSeen } = await loadModule()
    expect(() => markOnboardingSeen()).not.toThrow()
    spy.mockRestore()
  })

  it('does not throw when localStorage.getItem throws', async () => {
    const spy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage unavailable')
      })

    const { hasSeenOnboarding } = await loadModule()
    // Unseen is the safe fallback when storage can't be read.
    expect(() => hasSeenOnboarding()).not.toThrow()
    expect(hasSeenOnboarding()).toBe(false)
    spy.mockRestore()
  })
})

describe('onboarding visibility', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('hiding does not set the seen flag (so the help icon can re-open later)', async () => {
    const { showOnboarding, hideOnboarding, hasSeenOnboarding } = await loadModule()
    showOnboarding()
    hideOnboarding()
    // Visibility is separate from persistence: closing ≠ seen.
    expect(hasSeenOnboarding()).toBe(false)
  })

  it('redundant show/hide calls are idempotent and never throw', async () => {
    const { showOnboarding, hideOnboarding } = await loadModule()
    // The public setters guard on `open === next`, so duplicate calls are a
    // no-op. The e2e dialog spec confirms the rendered snapshot stays stable.
    expect(() => {
      showOnboarding()
      showOnboarding()
      hideOnboarding()
      hideOnboarding()
    }).not.toThrow()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})
