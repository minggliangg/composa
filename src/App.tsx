import { useEffect } from 'react'
import { TopBar } from './panels/TopBar'
import { LeftPanel } from './panels/LeftPanel/LeftPanel'
import { CompositionCanvas } from './canvas/CompositionCanvas'
import { RightPanel } from './panels/RightPanel/RightPanel'
import { StatusBar } from './components/StatusBar'
import { OnboardingDialog } from './components/OnboardingDialog'
import { hasSeenOnboarding, showOnboarding } from './state/onboarding'

/**
 * Three-panel editor shell: TopBar above a responsive row of
 * LeftPanel | CompositionCanvas | RightPanel, with a live StatusBar footer.
 * Panels stack vertically on narrow screens and remain visually distinct.
 *
 * On first run (the device has never seen the walkthrough, per
 * `hasSeenOnboarding()`), the OnboardingDialog opens automatically. It can
 * always be re-opened from the TopBar help (?) icon regardless of that flag.
 */
function App() {
  // First-run gating: read the persisted flag ONCE on mount and open the
  // walkthrough if it has never been dismissed. Re-open via the help icon is
  // handled entirely in TopBar and does not depend on this effect.
  useEffect(() => {
    if (!hasSeenOnboarding()) showOnboarding()
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
      <TopBar />
      {/* Three columns only once there's real room for them. Activating at
          `md` (768px) left the canvas ~112px wide next to two fixed-width
          panels (288 + 320). `xl` (1280px) gives the canvas ~624px after the
          panels; below that we stay stacked rather than crush the middle. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 xl:flex-row">
        <LeftPanel />
        <CompositionCanvas />
        <RightPanel />
      </div>
      <StatusBar />
      <OnboardingDialog />
    </div>
  )
}

export default App
