/**
 * Onboarding walkthrough controller.
 *
 * Two concerns, deliberately kept separate:
 *
 *   1. **Persistence** — whether THIS device has ever seen the walkthrough.
 *      Stored in `localStorage('composa-onboarding-seen')` so a genuine first
 *      run (empty storage) auto-opens the dialog, while returning users land
 *      straight in the editor. `App.tsx` reads this once on mount to decide
 *      whether to call `showOnboarding()`.
 *
 *   2. **Visibility** — whether the dialog is open RIGHT NOW. This is purely
 *      ephemeral (an in-memory boolean), so the TopBar help (?) icon can
 *      re-open the walkthrough on demand regardless of the persisted flag, and
 *      so closing the dialog never flips back the seen flag.
 *
 * Persistence mirrors `theme.ts`: `useSyncExternalStore` plumbing, a module-
 * level listener set, and graceful `try/catch` around every localStorage call
 * so private mode / SSR degrade to in-memory-only without throwing.
 */
import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'composa-onboarding-seen'
const SEEN_VALUE = '1'

// --- Persistence (the "has this device seen it?" flag) ---------------------

function readStoredSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === SEEN_VALUE
  } catch {
    /* localStorage unavailable — treat as unseen (will show once, in-memory). */
    return false
  }
}

function writeStoredSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, SEEN_VALUE)
  } catch {
    /* localStorage unavailable — in-memory only, no-op. */
  }
}

/** Has this device seen the onboarding before? (Reads localStorage fresh.) */
export function hasSeenOnboarding(): boolean {
  return readStoredSeen()
}

/** Persist the seen flag so the walkthrough won't auto-open on the next load. */
export function markOnboardingSeen(): void {
  writeStoredSeen()
}

// --- Visibility (is the dialog open right now?) ----------------------------

let open = false
const listeners = new Set<() => void>()

function setOpen(next: boolean): void {
  if (next === open) return
  open = next
  for (const l of listeners) l()
}

/** Open the walkthrough. Works whether or not it has been seen before. */
export function showOnboarding(): void {
  setOpen(true)
}

/** Close the walkthrough without touching the persisted seen flag. */
export function hideOnboarding(): void {
  setOpen(false)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): boolean {
  return open
}

/**
 * React hook returning whether the dialog is currently open. Re-renders on
 * open/close. The server snapshot is `false` (dialog closed) — only matters if
 * this app is ever SSR'd, which it currently isn't.
 */
export function useOnboardingOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false,
  )
}
