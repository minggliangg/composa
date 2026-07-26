import { TopBar } from './panels/TopBar'
import { LeftPanel } from './panels/LeftPanel/LeftPanel'
import { CompositionCanvas } from './canvas/CompositionCanvas'
import { RightPanel } from './panels/RightPanel/RightPanel'
import { StatusBar } from './components/StatusBar'

/**
 * Three-panel editor shell: TopBar above a responsive row of
 * LeftPanel | CompositionCanvas | RightPanel, with a live StatusBar footer.
 * Panels stack vertically on narrow screens and remain visually distinct.
 */
function App() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:flex-row">
        <LeftPanel />
        <CompositionCanvas />
        <RightPanel />
      </div>
      <StatusBar />
    </div>
  )
}

export default App
