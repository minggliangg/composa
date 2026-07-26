import { PropertiesForm } from './PropertiesForm'
import { AlignmentToolbar } from './AlignmentToolbar'

/**
 * Right panel: alignment controls + layer properties. ~320px on desktop
 * (xl:w-80), full width and stacked on narrow screens.
 */
export function RightPanel() {
  return (
    <aside className="flex w-full flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface p-3 shadow-sm xl:w-80">
      <AlignmentToolbar />
      <PropertiesForm />
    </aside>
  )
}
