import { UploadDropzone } from './UploadDropzone'
import { LayerList } from './LayerList'

/**
 * Left panel: image upload + layer list. ~280px on desktop (md:w-72), full
 * width and stacked on narrow screens.
 */
export function LeftPanel() {
  return (
    <aside className="flex w-full flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface p-3 shadow-sm md:w-72">
      <UploadDropzone />
      <LayerList />
    </aside>
  )
}
