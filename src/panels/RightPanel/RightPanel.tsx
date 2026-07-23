import { PropertiesForm } from './PropertiesForm'

/**
 * Right panel: layer properties. ~320px on desktop (md:w-80), full width and
 * stacked on narrow screens.
 */
export function RightPanel() {
  return (
    <aside className="flex w-full flex-col gap-3 rounded-md border border-slate-300 bg-slate-50 p-3 md:w-80">
      <PropertiesForm />
    </aside>
  )
}
