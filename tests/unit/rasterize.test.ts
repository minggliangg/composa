import { describe, it, expect } from 'vitest'
import { rasterizeSvg, MAX_RASTER_AREA } from '../../src/export/rasterize'

/**
 * `rasterizeSvg` is DOM-backed (jsdom has no rasterizer) so the full path is
 * covered by the webp-export e2e. The AREA GUARD, however, is pure math that
 * runs BEFORE any DOM touch — it fails fast with a stable machine-readable
 * code, which is assertable here.
 */
describe('rasterizeSvg canvas-area guard', () => {
  it('exposes a conservative ceiling (2^28 px = Chromium desktop canvas limit)', () => {
    expect(MAX_RASTER_AREA).toBe(2 ** 28)
  })

  it('rejects canvas_too_large before allocating anything', async () => {
    // 30000×30000 = 900 MP — over the guard, and (in a real browser) over any
    // engine's canvas limit. The guard must fire before createElement, so
    // this passes in jsdom where no rasterizer exists at all.
    await expect(
      rasterizeSvg({
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        width: 30000,
        height: 30000,
        format: 'image/webp',
      }),
    ).rejects.toThrow('canvas_too_large')
  })
})
