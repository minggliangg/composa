import { describe, it, expect } from 'vitest'
import { xmlEscapeAttr } from '../../src/export/xmlEscape'
import {
  buildSvgDocument,
  FONT_COPYRIGHT,
  FONT_LICENSE,
} from '../../src/export/buildSvgDocument'
import type { LayerSource } from '../../src/export/buildSvgDocument'
import type { EmbeddedFontFace } from '../../src/export/fontEmbed'
import { namespaceSvgMarkup } from '../../src/export/svgNamespace'
import { assignLayerIds, borderIdKey } from '../../src/export/layerIds'
import { borderRect } from '../../src/canvas/border'
import { layoutText, measureText } from '../../src/text/textMetrics'
import type { CompositionState, Layer, LayerBorder, TextContent } from '../../src/types/layer'

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
    name: null,
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
      name: null,      x: 200,
      y: 150,
      width: 120,
      height: 90,
      zIndex: 2,
      isBaseImage: false,
    }),
    makeLayer({
      id: 'base',
      originalFilename: 'base.png',
      name: null,      x: 0,
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
      name: null,      x: 50,
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
          name: null,          zIndex: 0,
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

  it('emits a TRANSPARENT blank base as a <rect fill="none"> (alpha survives)', () => {
    const state: CompositionState = {
      canvas: { width: 512, height: 512 },
      layers: [
        makeLayer({
          id: 'blank-base',
          originalFilename: 'blank-512.svg',
          name: null,          zIndex: 0,
          isBaseImage: true,
          x: 0,
          y: 0,
          width: 512,
          height: 512,
          naturalWidth: 512,
          naturalHeight: 512,
        }),
      ],
      selectedLayerIds: [],
      isDirty: false,
    }
    const sources: Record<string, LayerSource> = {
      'blank-base': { kind: 'blank', fill: null },
    }
    const built = buildSvgDocument(state, sources, FIXED_OPTS)
    const doc = parse(built)
    // No <image> (never an embedded raster) — the layer stays a literal rect…
    expect(doc.querySelectorAll('image')).toHaveLength(0)
    const rect = doc.querySelector('rect')
    expect(rect).not.toBeNull()
    // …but a TRANSPARENT one: fill="none" paints nothing, so the rasterized
    // WebP export keeps its alpha where the base doesn't cover.
    expect(rect!.getAttribute('fill')).toBe('none')
    expect(rect!.getAttribute('data-role')).toBe('base')
    expect(rect!.getAttribute('data-filename')).toBe('blank-512.svg')
    // Raw-byte form too — a rasterizer sees exactly this attribute.
    expect(built).toContain('fill="none"')
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
          name: null,
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
        name: null,
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

// --- ids + text + font embedding -----------------------------------------

describe('buildSvgDocument — exported ids', () => {
  function parse(svg: string) {
    return new DOMParser().parseFromString(svg, 'image/svg+xml')
  }

  it('gives every layer element a unique id', () => {
    const svg = buildSvgDocument(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)
    const doc = parse(svg)
    const els = Array.from(doc.querySelectorAll('image,rect,svg > svg'))
    const ids = els.map((e) => e.getAttribute('id'))
    expect(ids.every((id) => id !== null)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length) // all unique
  })

  it('keeps ids stable across two builds of the same input', () => {
    const a = parse(buildSvgDocument(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS))
    const b = parse(buildSvgDocument(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS))
    const ids = (doc: Document) =>
      Array.from(doc.querySelectorAll('image,rect,svg > svg')).map((e) =>
        e.getAttribute('id'),
      )
    expect(ids(a)).toEqual(ids(b))
  })

  it('emits data-name only for layers with a custom name', () => {
    const state: CompositionState = {
      ...FIXED_STATE,
      layers: FIXED_STATE.layers.map((l, i) =>
        i === 0 ? { ...l, name: 'hero' } : { ...l, name: null },
      ),
    }
    const doc = parse(buildSvgDocument(state, FIXED_SOURCES, FIXED_OPTS))
    const named = Array.from(doc.querySelectorAll('[data-name]'))
    expect(named).toHaveLength(1)
    expect(named[0].getAttribute('data-name')).toBe('hero')
  })
})

describe('buildSvgDocument — text layers', () => {
  function parse(svg: string) {
    return new DOMParser().parseFromString(svg, 'image/svg+xml')
  }

  const textContent: TextContent = {
    content: 'Hello\nWorld',
    fontSize: 10,
    fontWeight: 400,
    italic: false,
    fill: '#000000',
    align: 'left',
  }

  function textState(): CompositionState {
    const measured = measureText(textContent.content, textContent.fontSize)
    return {
      canvas: { width: 200, height: 200 },
      layers: [
        makeLayer({
          id: 'base',
          originalFilename: 'b.png',
          isBaseImage: true,
          zIndex: 0,
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          naturalWidth: 200,
          naturalHeight: 200,
        }),
        makeLayer({
          id: 'txt',
          originalFilename: 'Text',
          name: null,
          mimeType: 'text/plain',
          fullResBytesRef: { kind: 'text', text: textContent },
          zIndex: 1,
          x: 10,
          y: 10,
          width: measured.width,
          height: measured.height,
          naturalWidth: measured.width,
          naturalHeight: measured.height,
        }),
      ],
      selectedLayerIds: [],
      isDirty: false,
    }
  }

  const textSources: Record<string, LayerSource> = {
    base: { kind: 'blank', fill: '#ffffff' },
    txt: { kind: 'text', text: textContent },
  }

  it('emits a text layer as a nested <svg> + <text>/<tspan> and NO hit-rect', () => {
    const svg = buildSvgDocument(textState(), textSources, FIXED_OPTS)
    const doc = parse(svg)
    const nested = doc.querySelector('svg > svg')
    expect(nested).not.toBeNull()
    expect(nested!.querySelector('text')).not.toBeNull()
    expect(nested!.querySelectorAll('tspan').length).toBe(2)
    // The editor-only hit-rect must NOT leak into the export.
    expect(nested!.querySelectorAll('rect')).toHaveLength(0)
  })

  it('emits <tspan> coordinates equal to layoutText for the same input (anti-drift)', () => {
    const svg = buildSvgDocument(textState(), textSources, FIXED_OPTS)
    const doc = parse(svg)
    const tspans = Array.from(doc.querySelectorAll('svg > svg text tspan'))
    const expected = layoutText(textContent)
    expect(tspans.map((t) => t.getAttribute('x'))).toEqual(
      expected.map((l) => String(l.x)),
    )
    expect(tspans.map((t) => t.getAttribute('y'))).toEqual(
      expected.map((l) => String(l.y)),
    )
  })

  it('round-trips text containing & and < through the DOM parser', () => {
    const tricky: TextContent = { ...textContent, content: 'a & b < c' }
    const measured = measureText(tricky.content, tricky.fontSize)
    const state: CompositionState = {
      canvas: { width: 100, height: 100 },
      layers: [
        makeLayer({
          id: 't',
          fullResBytesRef: { kind: 'text', text: tricky },
          zIndex: 0,
          isBaseImage: true,
          width: 100,
          height: 100,
          naturalWidth: 100,
          naturalHeight: 100,
        }),
      ],
      selectedLayerIds: [],
      isDirty: false,
    }
    const doc = parse(
      buildSvgDocument(
        state,
        { t: { kind: 'text', text: tricky } },
        FIXED_OPTS,
      ),
    )
    expect(doc.querySelector('tspan')!.textContent).toBe('a & b < c')
  })
})

describe('buildSvgDocument — font embedding', () => {
  function parse(svg: string) {
    return new DOMParser().parseFromString(svg, 'image/svg+xml')
  }

  const faces: EmbeddedFontFace[] = [
    { style: 'normal', dataUri: 'data:font/woff2;base64,Bg==NORMAL' },
    { style: 'italic', dataUri: 'data:font/woff2;base64,Bg==ITALIC' },
  ]

  it('emits no <defs>/<style> when fontFaces is empty', () => {
    const svg = buildSvgDocument(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)
    const doc = parse(svg)
    expect(doc.querySelectorAll('defs')).toHaveLength(0)
    expect(doc.querySelectorAll('style')).toHaveLength(0)
    expect(svg).not.toContain('@font-face')
  })

  it('emits one @font-face per face with format(woff2) and the OFL notice', () => {
    const svg = buildSvgDocument(FIXED_STATE, FIXED_SOURCES, {
      ...FIXED_OPTS,
      fontFaces: faces,
    })
    const doc = parse(svg)
    // One <defs><style> block.
    expect(doc.querySelectorAll('defs')).toHaveLength(1)
    expect(doc.querySelectorAll('style')).toHaveLength(1)
    const css = doc.querySelector('style')!.textContent ?? ''
    // Two @font-face rules, one per face.
    expect(css.match(/@font-face/g)).toHaveLength(2)
    // format('woff2') — NOT the legacy 'woff2-variations' token.
    expect(css).toContain("format('woff2')")
    expect(css).not.toContain('woff2-variations')
    // Variable weight axis preserved.
    expect(css).toContain('font-weight: 200 800')
    // Both data URIs embedded.
    expect(css).toContain('Bg==NORMAL')
    expect(css).toContain('Bg==ITALIC')
    // The OFL notice comment carries the copyright + licence.
    expect(svg).toContain(FONT_COPYRIGHT)
    expect(svg).toContain('scripts.sil.org/OFL')
  })

  it('records the font licence + copyright in the metadata', () => {
    const doc = parse(
      buildSvgDocument(FIXED_STATE, FIXED_SOURCES, {
        ...FIXED_OPTS,
        fontFaces: faces,
      }),
    )
    const json = JSON.parse(
      doc.querySelector('metadata')!.textContent ?? '{}',
    )
    expect(json.fontLicense).toBe(FONT_LICENSE)
    expect(json.fontCopyright).toBe(FONT_COPYRIGHT)
  })

  it('has no "--" sequence inside the OFL notice comment (well-formed XML)', () => {
    const svg = buildSvgDocument(FIXED_STATE, FIXED_SOURCES, {
      ...FIXED_OPTS,
      fontFaces: faces,
    })
    const comment = svg.slice(svg.indexOf('<!--'), svg.indexOf('-->'))
    // The comment body (between <!-- and -->) must not contain "--".
    expect(comment.includes('--', 4)).toBe(false)
  })
})

// --- borders (Slice B) ----------------------------------------------------

describe('buildSvgDocument — borders', () => {
  function parse(svg: string) {
    return new DOMParser().parseFromString(svg, 'image/svg+xml')
  }

  const border: LayerBorder = { color: '#cccccc', width: 2, padding: 4 }

  /** A state with a blank base (no border) + one bordered overlay. */
  function borderedState(layer: Layer): CompositionState {
    return {
      canvas: { width: 800, height: 600 },
      layers: [
        makeLayer({
          id: 'base',
          originalFilename: 'b.png',
          isBaseImage: true,
          zIndex: 0,
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          naturalWidth: 800,
          naturalHeight: 600,
          fullResBytesRef: { kind: 'blank', fill: '#ffffff' },
        }),
        layer,
      ],
      selectedLayerIds: [],
      isDirty: false,
    }
  }

  function baseSources(overlay: LayerSource): Record<string, LayerSource> {
    return {
      base: { kind: 'blank', fill: '#ffffff' },
      ovl: overlay,
    }
  }

  it('emits exactly one border rect as the immediately-following sibling', () => {
    const overlay = makeLayer({
      id: 'ovl',
      name: null,
      originalFilename: 'o.png',
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      zIndex: 1,
      border,
    })
    const svg = buildSvgDocument(
      borderedState(overlay),
      baseSources({ kind: 'raster', dataUri: 'data:image/png;base64,ONE==' }),
      FIXED_OPTS,
    )
    const doc = parse(svg)
    const borders = Array.from(doc.querySelectorAll('rect[data-role="border"]'))
    expect(borders).toHaveLength(1)
    // The border is the next top-level element after the overlay's <image>.
    const rootChildren = Array.from(doc.documentElement.children)
    const imgIdx = rootChildren.findIndex((e) => e.tagName === 'image')
    expect(imgIdx).toBeGreaterThan(-1)
    expect(rootChildren[imgIdx + 1]).toBe(borders[0])
  })

  it('emitted border geometry equals borderRect(layer) field-for-field (anti-drift)', () => {
    const overlay = makeLayer({
      id: 'ovl',
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      zIndex: 1,
      border,
    })
    const r = borderRect(overlay)!
    const svg = buildSvgDocument(
      borderedState(overlay),
      baseSources({ kind: 'raster', dataUri: 'data:image/png;base64,ONE==' }),
      FIXED_OPTS,
    )
    const b = parse(svg).querySelector('rect[data-role="border"]')!
    expect(b.getAttribute('x')).toBe(String(r.x))
    expect(b.getAttribute('y')).toBe(String(r.y))
    expect(b.getAttribute('width')).toBe(String(r.width))
    expect(b.getAttribute('height')).toBe(String(r.height))
    expect(b.getAttribute('stroke-width')).toBe(String(r.strokeWidth))
  })

  it('carries hyphenated stroke-width + fill="none" and NO vector-effect', () => {
    const overlay = makeLayer({
      id: 'ovl',
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      zIndex: 1,
      border,
    })
    const svg = buildSvgDocument(
      borderedState(overlay),
      baseSources({ kind: 'raster', dataUri: 'data:image/png;base64,ONE==' }),
      FIXED_OPTS,
    )
    const b = parse(svg).querySelector('rect[data-role="border"]')!
    expect(b.getAttribute('stroke-width')).toBe('2')
    expect(b.getAttribute('fill')).toBe('none')
    expect(b.getAttribute('vector-effect')).toBeNull()
    expect(svg).not.toContain('vector-effect')
  })

  it("the border id is the layer's element id + '-border'", () => {
    const overlay = makeLayer({
      id: 'ovl',
      name: 'hero',
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      zIndex: 1,
      border,
    })
    const doc = parse(
      buildSvgDocument(
        borderedState(overlay),
        baseSources({ kind: 'raster', dataUri: 'data:image/png;base64,ONE==' }),
        FIXED_OPTS,
      ),
    )
    const img = doc.querySelector('image')!
    const b = doc.querySelector('rect[data-role="border"]')!
    expect(b.getAttribute('id')).toBe(img.getAttribute('id') + '-border')
  })

  it("the border opacity mirrors the layer's opacity", () => {
    const overlay = makeLayer({
      id: 'ovl',
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      zIndex: 1,
      opacity: 0.5,
      border,
    })
    const b = parse(
      buildSvgDocument(
        borderedState(overlay),
        baseSources({ kind: 'raster', dataUri: 'data:image/png;base64,ONE==' }),
        FIXED_OPTS,
      ),
    ).querySelector('rect[data-role="border"]')!
    expect(b.getAttribute('opacity')).toBe('0.5')
  })

  it('emits exactly one border rect for EVERY layer source kind (forgotten-arm guard)', () => {
    const tc: TextContent = {
      content: 'Hi',
      fontSize: 10,
      fontWeight: 400,
      italic: false,
      fill: '#000000',
      align: 'left',
    }
    const m = measureText(tc.content, tc.fontSize)
    const cases: { name: string; layer: Layer; source: LayerSource }[] = [
      {
        name: 'raster',
        layer: makeLayer({ id: 'ovl', x: 100, y: 100, width: 200, height: 150, zIndex: 1, border }),
        source: { kind: 'raster', dataUri: 'data:1' },
      },
      {
        name: 'blank',
        layer: makeLayer({ id: 'ovl', x: 100, y: 100, width: 200, height: 150, zIndex: 1, border }),
        source: { kind: 'blank', fill: '#ffffff' },
      },
      {
        name: 'rect',
        layer: makeLayer({ id: 'ovl', x: 100, y: 100, width: 200, height: 150, zIndex: 1, fullResBytesRef: { kind: 'rect', fill: null }, border }),
        source: { kind: 'rect', fill: null },
      },
      {
        name: 'text',
        layer: makeLayer({ id: 'ovl', x: 100, y: 100, width: m.width, height: m.height, naturalWidth: m.width, naturalHeight: m.height, zIndex: 1, mimeType: 'text/plain', fullResBytesRef: { kind: 'text', text: tc }, border }),
        source: { kind: 'text', text: tc },
      },
      {
        name: 'svg',
        layer: makeLayer({ id: 'ovl', x: 100, y: 100, width: 200, height: 150, zIndex: 1, mimeType: 'image/svg+xml', fullResBytesRef: { kind: 'svg', markup: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', viewBox: '0 0 10 10' }, border }),
        source: { kind: 'svg', inner: '<rect width="10" height="10"/>', viewBox: '0 0 10 10' },
      },
    ]
    for (const c of cases) {
      const doc = parse(buildSvgDocument(borderedState(c.layer), baseSources(c.source), FIXED_OPTS))
      const borders = Array.from(doc.querySelectorAll('rect[data-role="border"]'))
      expect(borders, c.name).toHaveLength(1)
    }
  })

  it('a bordered text layer still has 0 rects in its nested <svg>', () => {
    const tc: TextContent = {
      content: 'Hi',
      fontSize: 10,
      fontWeight: 400,
      italic: false,
      fill: '#000000',
      align: 'left',
    }
    const m = measureText(tc.content, tc.fontSize)
    const overlay = makeLayer({
      id: 'ovl',
      x: 100,
      y: 100,
      width: m.width,
      height: m.height,
      naturalWidth: m.width,
      naturalHeight: m.height,
      zIndex: 1,
      mimeType: 'text/plain',
      fullResBytesRef: { kind: 'text', text: tc },
      border,
    })
    const doc = parse(
      buildSvgDocument(borderedState(overlay), baseSources({ kind: 'text', text: tc }), FIXED_OPTS),
    )
    const nested = doc.querySelector('svg > svg')!
    expect(nested.querySelectorAll('rect')).toHaveLength(0)
  })

  it('a blank base with a border still yields the base from querySelector(rect)', () => {
    // The base never gets a border in the UI, but this guards the emission
    // ORDER: the border is emitted AFTER the base's own rect, so the base stays
    // the first <rect> (e.g. for blank-canvas templates).
    const state: CompositionState = {
      canvas: { width: 100, height: 100 },
      layers: [
        makeLayer({
          id: 'base',
          originalFilename: 'blank.svg',
          isBaseImage: true,
          zIndex: 0,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          naturalWidth: 100,
          naturalHeight: 100,
          fullResBytesRef: { kind: 'blank', fill: '#ffffff' },
          border,
        }),
      ],
      selectedLayerIds: [],
      isDirty: false,
    }
    const doc = parse(
      buildSvgDocument(state, { base: { kind: 'blank', fill: '#ffffff' } }, FIXED_OPTS),
    )
    const firstRect = doc.querySelector('rect')
    expect(firstRect).not.toBeNull()
    expect(firstRect!.getAttribute('data-role')).toBe('base')
    expect(firstRect!.getAttribute('fill')).toBe('#ffffff')
  })

  it('assignLayerIds reserves a border id unconditionally (identical with/without border)', () => {
    const ids = assignLayerIds([makeLayer({ id: 'a', name: 'hero', zIndex: 1 })])
    const idsBordered = assignLayerIds([
      makeLayer({ id: 'a', name: 'hero', zIndex: 1, border }),
    ])
    expect(ids.get('a')).toBe(idsBordered.get('a'))
    expect(ids.get(borderIdKey('a'))).toBe(idsBordered.get(borderIdKey('a')))
    expect(ids.get(borderIdKey('a'))).toBe('hero-border')
  })
})
