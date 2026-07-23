import { UploadDropzone } from './UploadDropzone'
import { LayerList } from './LayerList'

/**
 * Left panel: image upload + layer list. ~280px on desktop (md:w-72), full
 * width and stacked on narrow screens.
 */
export function LeftPanel() {
  return (
    <aside className="flex w-full flex-col gap-3 rounded-md border border-slate-800 bg-slate-900 p-3 shadow-sm md:w-72">
      <UploadDropzone />
      <LayerList />
    </aside>
  )
}
