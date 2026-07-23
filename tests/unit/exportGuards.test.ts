import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCompositionStore } from '../../src/state/compositionStore'
import { exportComposition } from '../../src/export/exportComposition'

/**
 * Phase 09 export-guard tests.
 *
 * `exportComposition` must refuse to produce a file when there is no base image
 * (plan §6 step 1: "no base image -> Export disabled"). This file asserts the
 * `{ ok: false, reason: 'no_base' }` path and that NO download is triggered.
 *
 * `downloadFile` is mocked so we can assert it is never called on this path
 * (and so a regression that bypassed the guard could not spin up a real anchor
 * click inside jsdom).
 */

vi.mock('../../src/export/downloadFile', () => ({
  downloadFile: vi.fn(),
}))

// Imported AFTER the mock is registered (Vitest hoists vi.mock above imports).
import { downloadFile } from '../../src/export/downloadFile'

beforeEach(() => {
  useCompositionStore.getState().resetComposition()
  vi.mocked(downloadFile).mockClear()
})

describe('exportComposition — no-base guard', () => {
  it('returns { ok: false, reason: "no_base" } when the composition is empty', async () => {
    const result = await exportComposition()
    expect(result).toEqual({ ok: false, reason: 'no_base' })
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "no_base" } even with overlays but no base', async () => {
    // Put a non-base layer in the store without ever setting a base image, so
    // `canvas` is still null and there is no isBaseImage layer.
    useCompositionStore.setState({
      layers: [
        {
          id: 'lonely-overlay',
          originalFilename: 'o.png',
          mimeType: 'image/png',
          previewUrl: 'blob:o',
          fullResBytesRef: { kind: 'file', file: new File([], 'o.png') },
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          naturalWidth: 10,
          naturalHeight: 10,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          visible: true,
          locked: false,
          isBaseImage: false,
        },
      ],
      canvas: null,
    })

    const result = await exportComposition()
    expect(result).toEqual({ ok: false, reason: 'no_base' })
    expect(downloadFile).not.toHaveBeenCalled()
  })
})
