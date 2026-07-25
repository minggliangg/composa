import { PropertiesForm } from './PropertiesForm'
import { AlignmentToolbar } from './AlignmentToolbar'

/**
 * Right panel: alignment controls + layer properties. ~320px on desktop
 * (md:w-80), full width and stacked on narrow screens.
 */
export function RightPanel() {
  return (
    <aside className="flex w-full flex-col gap-3 rounded-md border border-slate-800 bg-slate-900 p-3 shadow-sm md:w-80">
      <AlignmentToolbar />
      <PropertiesForm />
    </aside>
  )
}
