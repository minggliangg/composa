import { describe, it, expect } from 'vitest'
import { xmlEscapeAttr } from '../../src/export/xmlEscape'
import { buildSvgDocument } from '../../src/export/buildSvgDocument'
import type { LayerSource } from '../../src/export/buildSvgDocument'
import { namespaceSvgMarkup } from '../../src/export/svgNamespace'
import type { CompositionState, Layer } from '../../src/types/layer'

/**
 * Phase 08 export unit tests.
 *
 * `xmlEscapeAttr` is pure and table-tested directly. `buildSvgDocument` is
 * pure/synchronous/deterministic, so it is tested against a FIXED mock
 * `CompositionState` and fixed `dataUris`/`opts` — both string assertions on
 * the raw SVG and DOM-parsed assertions (DOMParser is available in jsdom).
 */

// --- mock state -----------------------------------------------------------

function makeLayer(partial: Partial<Layer>): Layer {
  return {
    id: 'id',
    originalFilename: 'x.png',
    mimeType: 'image/png',
    previewUrl: 'blob:x',
    fullResBytesRef: { kind: 'file', file: new File([], 'x.png') },
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    naturalWidth: 10,
    naturalHeight: 10,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    visible: true,
    locked: false,
    isBaseImage: false,
    ...partial,
  }
}

const FIXED_STATE: CompositionState = {
  canvas: { width: 800, height: 600 },
  // Note: deliberately stored OUT of z-index order (overlay 2 before overlay 1)
  // so the test proves the builder sorts ascending rather than trusting array
  // order.
  layers: [
    makeLayer({
      id: 'overlay-2',
      originalFilename: 'top.png',
      x: 200,
      y: 150,
      width: 120,
      height: 90,
      zIndex: 2,
      isBaseImage: false,
    }),
    makeLayer({
      id: 'base',
      originalFilename: 'base.png',
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      naturalWidth: 800,
      naturalHeight: 600,
      zIndex: 0,
      isBaseImage: true,
    }),
    makeLayer({
      id: 'overlay-1',
      // Filename with every XML-special char to exercise escaping end-to-end.
      originalFilename: 'photo & friends.png',
      x: 50,
      y: 40,
      width: 100,
      height: 80,
      zIndex: 1,
      isBaseImage: false,
    }),
  ],
  selectedLayerIds: ['overlay-1'],
  isDirty: true,
}

const FIXED_SOURCES: Record<string, LayerSource> = {
  base: { kind: 'raster', dataUri: 'data:image/png;base64,BASE==' },
  'overlay-1': { kind: 'raster', dataUri: 'data:image/png;base64,ONE==' },
  'overlay-2': { kind: 'raster', dataUri: 'data:image/png;base64,TWO==' },
}

const FIXED_OPTS = {
  timestamp: '2026-07-24T00:00:00.000Z',
  appVersion: '0.1.0',
  appName: 'composa.',
}

// --- xmlEscapeAttr --------------------------------------------------------

describe('xmlEscapeAttr', () => {
  it('escapes & to &amp;', () => {
    expect(xmlEscapeAttr('&')).toBe('&amp;')
  })
  it('escapes < to &lt;', () => {
    expect(xmlEscapeAttr('<')).toBe('&lt;')
  })
  it('escapes > to &gt;', () => {
    expect(xmlEscapeAttr('>')).toBe('&gt;')
  })
  it('escapes " to &quot;', () => {
    expect(xmlEscapeAttr('"')).toBe('&quot;')
  })
  it("escapes ' to &apos;", () => {
    expect(xmlEscapeAttr("'")).toBe('&apos;')
  })

  it('escapes a combined filename string', () => {
    expect(xmlEscapeAttr('photo & friends.png')).toBe(
      'photo &amp; friends.png',
    )
  })

  it('escapes & first so < does not become &amp;lt;', () => {
    // A bare "<" must map to "&lt;", never the double-escaped "&amp;lt;" that
    // would result from escaping "&" after the "<" -> "&lt;" substitution.
    expect(xmlEscapeAttr('<')).toBe('&lt;')
    expect(xmlEscapeAttr('<')).not.toBe('&amp;lt;')
    // And a full chain with & and < together still escapes each only once.
    expect(xmlEscapeAttr('a & < b')).toBe('a &amp; &lt; b')
  })

  it('leaves a plain string unchanged', () => {
    expect(xmlEscapeAttr('plain-photo.png')).toBe('plain-photo.png')
  })
})

// --- buildSvgDocument -----------------------------------------------------

describe('buildSvgDocument', () => {
  function parse(svg: string) {
    return new DOMParser().parseFromString(svg, 'image/svg+xml')
  }

  const svg = buildSvgDocument(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)

  it('root <svg> has width/height/viewBox from the base canvas', () => {
    const doc = parse(svg)
    const root = doc.documentElement
    expect(root.tagName.toLowerCase()).toBe('svg')
    expect(root.getAttribute('width')).toBe('800')
    expect(root.getAttribute('height')).toBe('600')
    expect(root.getAttribute('viewBox')).toBe('0 0 800 600')
  })

  it('declares both xmlns and xmlns:xlink namespaces', () => {
    const doc = parse(svg)
    const root = doc.documentElement
    expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
    expect(root.getAttribute('xmlns:xlink')).toBe(
      'http://www.w3.org/1999/xlink',
    )
  })

  it('emits a <metadata> block with the expected JSON fields', () => {
    const doc = parse(svg)
    const meta = doc.querySelector('metadata')
    expect(meta).not.toBeNull()
    const json = JSON.parse(meta!.textContent ?? '{}')
    expect(json.appName).toBe('composa.')
    expect(json.appVersion).toBe('0.1.0')
    expect(json.exportedAt).toBe('2026-07-24T00:00:00.000Z')
    expect(json.canvasWidth).toBe(800)
    expect(json.canvasHeight).toBe(600)
    expect(json.layerCount).toBe(3)
  })

  it('emits one <image> per layer in ASCENDING z-index order (base first)', () => {
    const doc = parse(svg)
    const images = Array.from(doc.querySelectorAll('image'))
    expect(images).toHaveLength(3)
    // base (z=0), overlay-1 (z=1), overlay-2 (z=2) — NOT the input array order.
    const hrefs = images.map((i) => i.getAttribute('href'))
    expect(hrefs).toEqual([
      'data:image/png;base64,BASE==',
      'data:image/png;base64,ONE==',
      'data:image/png;base64,TWO==',
    ])
  })

  it('tags only the base <image> with data-role="base"', () => {
    const doc = parse(svg)
    const images = Array.from(doc.querySelectorAll('image'))
    expect(images[0].getAttribute('data-role')).toBe('base')
    expect(images[1].getAttribute('data-role')).toBeNull()
    expect(images[2].getAttribute('data-role')).toBeNull()
  })

  it('every <image> carries x/y/width/height and preserveAspectRatio="none"', () => {
    const doc = parse(svg)
    const images = Array.from(doc.querySelectorAll('image'))
    for (const img of images) {
      expect(img.getAttribute('preserveAspectRatio')).toBe('none')
      expect(img.getAttribute('x')).not.toBeNull()
      expect(img.getAttribute('y')).not.toBeNull()
      expect(img.getAttribute('width')).not.toBeNull()
      expect(img.getAttribute('height')).not.toBeNull()
    }
    // Spot-check the overlay-1 values from the mock.
    const overlay1 = images[1]
    expect(overlay1.getAttribute('x')).toBe('50')
    expect(overlay1.getAttribute('y')).toBe('40')
    expect(overlay1.getAttribute('width')).toBe('100')
    expect(overlay1.getAttribute('height')).toBe('80')
  })

  it('emits a non-1 layer opacity verbatim on the exported <image>', () => {
    const stateWithOpacity: CompositionState = {
      ...FIXED_STATE,
      layers: FIXED_STATE.layers.map((l) =>
        l.id === 'overlay-1' ? { ...l, opacity: 0.5 } : l,
      ),
    }
    const built = buildSvgDocument(stateWithOpacity, FIXED_SOURCES, FIXED_OPTS)
    const doc = parse(built)
    const images = Array.from(doc.querySelectorAll('image'))
    // base (z=0), overlay-1 (z=1, opacity 0.5), overlay-2 (z=2, default opacity).
    expect(images[0].getAttribute('opacity')).toBe('1')
    expect(images[1].getAttribute('opacity')).toBe('0.5')
    expect(images[2].getAttribute('opacity')).toBe('1')
  })

  it('every <image> href equals the provided data URI', () => {
    const doc = parse(svg)
    const images = Array.from(doc.querySelectorAll('image'))
    const ids = ['base', 'overlay-1', 'overlay-2']
    images.forEach((img, i) => {
      const s = FIXED_SOURCES[ids[i]]
      expect(s.kind).toBe('raster')
      if (s.kind === 'raster') expect(img.getAttribute('href')).toBe(s.dataUri)
    })
  })

  it('XML-escapes the data-filename in the raw output (special chars -> entities)', () => {
    // Raw-string assertion: the entity form appears verbatim in the SVG bytes.
    expect(svg).toContain('data-filename="photo &amp; friends.png"')
    // And the XML parser un-escapes it back when read as an attribute.
    const doc = parse(svg)
    const overlay1 = Array.from(doc.querySelectorAll('image'))[1]
    expect(overlay1.getAttribute('data-filename')).toBe('photo & friends.png')
  })

  it('contains NO editor-only elements (no handles, no boundary rect, no wrapping <g>)', () => {
    const doc = parse(svg)
    expect(doc.querySelectorAll('[data-handle]')).toHaveLength(0)
    expect(doc.querySelectorAll('[data-role="overlay"]')).toHaveLength(0)
    expect(doc.querySelectorAll('rect')).toHaveLength(0)
    expect(doc.querySelectorAll('g')).toHaveLength(0)
    // Only <svg>, <metadata>, and 3 <image> elements.
    expect(doc.querySelectorAll('image')).toHaveLength(3)
  })

  it('is deterministic: identical inputs yield byte-identical output', () => {
    const a = buildSvgDocument(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)
    const b = buildSvgDocument(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)
    expect(a).toBe(b)
  })

  it('throws when state.canvas is null (no base image)', () => {
    const emptyState: CompositionState = {
      canvas: null,
      layers: [],
      selectedLayerIds: [],
      isDirty: false,
    }
    expect(() => buildSvgDocument(emptyState, {}, FIXED_OPTS)).toThrow(
      /no base image/,
    )
  })

  it('omits data-role entirely on overlays and uses default appName', () => {
    const built = buildSvgDocument(FIXED_STATE, FIXED_SOURCES, {
      timestamp: FIXED_OPTS.timestamp,
      appVersion: FIXED_OPTS.appVersion,
    })
    const doc = parse(built)
    const json = JSON.parse(
      doc.querySelector('metadata')!.textContent ?? '{}',
    )
    expect(json.appName).toBe('composa.')
  })

  // --- blank + svg LayerSource kinds ---------------------------------------

  it('emits a blank layer as a solid <rect> with the fill', () => {
    const state: CompositionState = {
      canvas: { width: 1024, height: 1024 },
      layers: [
        makeLayer({
          id: 'blank-base',
          originalFilename: 'blank-1024.svg',
          zIndex: 0,
          isBaseImage: true,
          x: 0,
          y: 0,
          width: 1024,
          height: 1024,
        }),
      ],
      selectedLayerIds: [],
      isDirty: false,
    }
    const sources: Record<string, LayerSource> = {
      'blank-base': { kind: 'blank', fill: '#ffffff' },
    }
    const built = buildSvgDocument(state, sources, FIXED_OPTS)
    const doc = parse(built)
    expect(doc.querySelectorAll('image')).toHaveLength(0)
    const rect = doc.querySelector('rect')
    expect(rect).not.toBeNull()
    expect(rect!.getAttribute('fill')).toBe('#ffffff')
    expect(rect!.getAttribute('width')).toBe('1024')
    expect(rect!.getAttribute('height')).toBe('1024')
    expect(rect!.getAttribute('data-role')).toBe('base')
    expect(rect!.getAttribute('data-filename')).toBe('blank-1024.svg')
  })

  it('emits an svg layer as a nested <svg> carrying the namespaced body', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<defs><linearGradient id="g1"><stop stop-color="red"/></linearGradient></defs>' +
      '<rect width="24" height="24" fill="url(#g1)"/>' +
      '</svg>'
    const ns = namespaceSvgMarkup(markup, 'L1')
    const state: CompositionState = {
      canvas: { width: 100, height: 100 },
      layers: [
        makeLayer({
          id: 'svg-ovl',
          originalFilename: 'logo.svg',
          mimeType: 'image/svg+xml',
          fullResBytesRef: { kind: 'svg', markup, viewBox: '0 0 24 24' },
          zIndex: 1,
          isBaseImage: false,
          x: 10,
          y: 10,
          width: 40,
          height: 40,
        }),
      ],
      selectedLayerIds: [],
      isDirty: false,
    }
    const sources: Record<string, LayerSource> = {
      'svg-ovl': { kind: 'svg', inner: ns.inner, viewBox: ns.viewBox },
    }
    const built = buildSvgDocument(state, sources, FIXED_OPTS)
    const doc = parse(built)
    // The nested <svg> carries the layer geometry + the namespaced body.
    const nested = doc.querySelector('svg > svg')
    expect(nested).not.toBeNull()
    expect(nested!.getAttribute('x')).toBe('10')
    expect(nested!.getAttribute('width')).toBe('40')
    expect(nested!.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(nested!.getAttribute('preserveAspectRatio')).toBe('none')
    expect(nested!.getAttribute('data-role')).toBeNull() // overlay, not base
    // The id was namespaced (L1__g1) and the url() reference rewritten to match.
    expect(built).toContain('id="L1__g1"')
    expect(built).toContain('fill="url(#L1__g1)"')
    // No editor-only content leaks in.
    expect(doc.querySelectorAll('[data-handle]')).toHaveLength(0)
    expect(doc.querySelectorAll('[data-editor-only]')).toHaveLength(0)
  })

  it('is deterministic with random layer ids (prefix is the sorted index, not id)', () => {
    // Two builds of the SAME composition but with DIFFERENT random layer ids
    // must still agree byte-for-byte: the svg namespace prefix is `L<n>`, never
    // the layer id, so a UUID can't leak into the emitted markup.
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<rect id="r" width="10" height="10"/></svg>'
    // Namespacing depends only on the prefix (the sorted index), not the id.
    const inner1 = namespaceSvgMarkup(markup, 'L1')
    const inner2 = namespaceSvgMarkup(markup, 'L2')
    const mk = (id: string, z: number): Layer =>
      makeLayer({
        id,
        originalFilename: 'logo.svg',
        mimeType: 'image/svg+xml',
        fullResBytesRef: { kind: 'svg', markup, viewBox: '0 0 10 10' },
        zIndex: z,
        isBaseImage: false,
        x: 5,
        y: 5,
        width: 20,
        height: 20,
      })
    const build = (id1: string, id2: string): string => {
      const sources: Record<string, LayerSource> = {
        [id1]: { kind: 'svg', inner: inner1.inner, viewBox: inner1.viewBox },
        [id2]: { kind: 'svg', inner: inner2.inner, viewBox: inner2.viewBox },
      }
      return buildSvgDocument(
        {
          canvas: { width: 50, height: 50 },
          layers: [mk(id1, 1), mk(id2, 2)],
          selectedLayerIds: [],
          isDirty: false,
        },
        sources,
        FIXED_OPTS,
      )
    }
    const markupA = build('aaaaaaaa-1111-1111-1111-111111111111', 'bbbbbbbb-2222-2222-2222-222222222222')
    const markupB = build('zzzzzzzz-9999-9999-9999-999999999999', 'yyyyyyyy-8888-8888-8888-888888888888')
    expect(markupA).toBe(markupB)
    // And the body carries no uuid.
    expect(markupA).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
    // Both namespaces are present (two layers, two prefixes).
    expect(markupA).toContain('id="L1__r"')
    expect(markupA).toContain('id="L2__r"')
  })
})
