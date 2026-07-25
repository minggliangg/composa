/**
 * Theme controller for the dark/light toggle.
 *
 * The single source of truth for the active theme is the `.dark` class on
 * `<html>` (set before first paint by the inline script in index.html). This
 * module mirrors that class into JS-accessible state so React components can
 * render a toggle and subscribe to changes via `useTheme()`.
 *
 * Persistence: `localStorage('composa-theme')` holds `'light'` | `'dark'`. The
 * pre-paint script reads it on load to avoid a flash; this module writes it on
 * every change. If localStorage is unavailable (private mode, SSR), everything
 * degrades gracefully to the in-memory default.
 */
import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'composa-theme'

/** In-memory fallback when localStorage is unavailable. */
let currentTheme: Theme = resolveInitialTheme()

// Module-level listener set — useSyncExternalStore subscribes via this.
const listeners = new Set<() => void>()

function resolveInitialTheme(): Theme {
  // The pre-paint script in index.html has already applied the `.dark` class
  // from localStorage / prefers-color-scheme before this module loads, so we
  // can read the DOM as the source of truth instead of re-parsing storage.
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* localStorage unavailable — in-memory only, no-op. */
  }
}

/** Apply a theme to the DOM and persist it, notifying subscribers. */
function applyTheme(theme: Theme): void {
  currentTheme = theme
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }
  writeStoredTheme(theme)
  for (const l of listeners) l()
}

export function getTheme(): Theme {
  return currentTheme
}

export function setTheme(theme: Theme): void {
  if (theme === currentTheme) return
  applyTheme(theme)
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

// --- useSyncExternalStore plumbing ---

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): Theme {
  return currentTheme
}

/**
 * React hook returning the current theme. Re-renders on toggle. The server
 * snapshot is dark (the tool's native look); only matters if this app is ever
 * SSR'd, which it currently isn't.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => 'dark' as Theme,
  )
}
