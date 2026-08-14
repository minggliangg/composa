import { describe, it, expect } from 'vitest'
import {
  buildLayerManifest,
  serializeLayerManifest,
  MANIFEST_FORMAT,
} from '../../src/export/layerManifest'
import { assignLayerIds } from '../../src/export/layerIds'
import type { LayerSource } from '../../src/export/buildSvgDocument'
import type { CompositionState, Layer } from '../../src/types/layer'

/**
 * Manifest builder tests — the JSON half of the WebP export. The builder is
 * pure/synchronous/deterministic (same discipline as `buildSvgDocument`), so
 * it is tested against FIXED state + sources + opts: object-shape assertions on
 * the built document, cross-reference assertions against `assignLayerIds`
 * (manifest `exportId` must equal the exported SVG element id), and
 * determinism assertions on the serialized bytes.
 */

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
  // Deliberately stored OUT of z-index order so the tests prove the manifest
  // sorts ascending (base first) rather than trusting array order.
  layers: [
    makeLayer({
      id: 'hero',
      originalFilename: 'hero.png',
      name: 'Hero',
      x: 50,
      y: 40,
      width: 100,
      height: 80,
      opacity: 0.5,
      zIndex: 1,
      border: { color: '#111111', width: 2, padding: 4 },
    }),
    makeLayer({
      id: 'blank-base',
      originalFilename: 'blank-800.svg',
      mimeType: 'image/svg+xml',
      previewUrl: 'data:image/svg+xml,%3Csvg%3E',
      fullResBytesRef: { kind: 'blank', fill: null },
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
      id: 'note',
      originalFilename: 'Text',
      mimeType: 'text/plain',
      fullResBytesRef: {
        kind: 'text',
        text: {
          content: 'Hello\nWorld',
          fontSize: 12,
          fontWeight: 400,
          italic: false,
          fill: '#0f1724',
          align: 'left',
        },
      },
      x: 200,
      y: 120,
      width: 60,
      height: 40,
      naturalWidth: 60,
      naturalHeight: 40,
      zIndex: 2,
    }),
    makeLayer({
      id: 'frame',
      originalFilename: 'Frame',
      mimeType: 'image/svg+xml',
      fullResBytesRef: { kind: 'rect', fill: null },
      x: 10,
      y: 10,
      width: 300,
      height: 200,
      zIndex: 3,
    }),
  ],
  selectedLayerIds: [],
  isDirty: true,
}

const FIXED_SOURCES: Record<string, LayerSource> = {
  'blank-base': { kind: 'blank', fill: null },
  hero: { kind: 'raster', dataUri: 'data:image/png;base64,HERO==' },
  note: {
    kind: 'text',
    text: {
      content: 'Hello\nWorld',
      fontSize: 12,
      fontWeight: 400,
      italic: false,
      fill: '#0f1724',
      align: 'left',
    },
  },
  frame: { kind: 'rect', fill: null },
}

const FIXED_OPTS = {
  timestamp: '2026-08-14T00:00:00.000Z',
  appVersion: '0.1.0',
  appName: 'composa.',
  imageFilename: 'composition.webp',
  imageMimeType: 'image/webp',
}

describe('buildLayerManifest', () => {
  it('throws when state.canvas is null (the orchestrator guards first)', () => {
    expect(() =>
      buildLayerManifest(
        { ...FIXED_STATE, canvas: null },
        FIXED_SOURCES,
        FIXED_OPTS,
      ),
    ).toThrow('state.canvas is null')
  })

  it('describes the canvas and the sibling raster file in image pixels', () => {
    const m = buildLayerManifest(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)
    expect(m.format).toBe(MANIFEST_FORMAT)
    expect(m.format).toBe('composa.manifest/1')
    expect(m.generator).toEqual({ name: 'composa.', version: '0.1.0' })
    expect(m.exportedAt).toBe(FIXED_OPTS.timestamp)
    expect(m.canvas).toEqual({ width: 800, height: 600 })
    expect(m.image).toEqual({
      filename: 'composition.webp',
      mimeType: 'image/webp',
      width: 800,
      height: 600,
    })
  })

  it('lists layers in ascending z-index order (base first)', () => {
    const m = buildLayerManifest(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)
    expect(m.layers.map((l) => l.id)).toEqual([
      'blank-base',
      'hero',
      'note',
      'frame',
    ])
    expect(m.layers.map((l) => l.zIndex)).toEqual([0, 1, 2, 3])
  })

  it('carries each layer geometry verbatim, in image-pixel units', () => {
    const m = buildLayerManifest(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)
    const hero = m.layers.find((l) => l.id === 'hero')!
    expect(hero).toMatchObject({
      filename: 'hero.png',
      kind: 'raster',
      x: 50,
      y: 40,
      width: 100,
      height: 80,
      rotation: 0,
      opacity: 0.5,
      zIndex: 1,
      isBase: false,
    })
    expect(m.layers.find((l) => l.id === 'blank-base')!.isBase).toBe(true)
  })

  it('derives names via the SAME layerDisplayLabel chain as exported SVG ids', () => {
    const m = buildLayerManifest(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)
    const byId = Object.fromEntries(m.layers.map((l) => [l.id, l]))
    // Custom name wins.
    expect(byId.hero.name).toBe('Hero')
    // A text layer's derived label is its FIRST CONTENT LINE, not 'Text'.
    expect(byId.note.name).toBe('Hello')
    // Everything else falls back to the original filename.
    expect(byId['blank-base'].name).toBe('blank-800.svg')
    expect(byId.frame.name).toBe('Frame')
  })

  it('cross-references exportId with the exported SVG element ids', () => {
    const m = buildLayerManifest(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)
    const idMap = assignLayerIds(FIXED_STATE.layers)
    for (const entry of m.layers) {
      expect(entry.exportId).toBe(idMap.get(entry.id))
    }
    // Sanitized NCNames, not raw UUIDs.
    expect(m.layers.find((l) => l.id === 'hero')!.exportId).toBe('Hero')
  })

  it('includes fill only for blank/rect kinds, and border only when present', () => {
    const m = buildLayerManifest(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)
    const byId = Object.fromEntries(m.layers.map((l) => [l.id, l]))
    expect(byId['blank-base'].fill).toBeNull()
    expect(byId.frame.fill).toBeNull()
    expect(byId.hero.fill).toBeUndefined()
    expect(byId.note.fill).toBeUndefined()
    expect(byId.hero.border).toEqual({
      color: '#111111',
      width: 2,
      padding: 4,
    })
    expect(byId.note.border).toBeUndefined()
    expect(byId['blank-base'].border).toBeUndefined()
  })

  it('falls back to a white blank source for a layer missing from sources', () => {
    // Mirrors the builder's fallback so manifest + SVG agree even on a
    // malformed sources record.
    const m = buildLayerManifest(FIXED_STATE, {}, FIXED_OPTS)
    expect(m.layers.find((l) => l.id === 'hero')!.kind).toBe('blank')
    expect(m.layers.find((l) => l.id === 'hero')!.fill).toBe('#ffffff')
  })
})

describe('serializeLayerManifest', () => {
  it('is deterministic: identical inputs, byte-identical output', () => {
    const a = serializeLayerManifest(
      buildLayerManifest(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS),
    )
    const b = serializeLayerManifest(
      buildLayerManifest(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS),
    )
    expect(a).toBe(b)
  })

  it('round-trips through JSON.parse and pretty-prints with 2-space indent', () => {
    const m = buildLayerManifest(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS)
    const s = serializeLayerManifest(m)
    expect(JSON.parse(s)).toEqual(m)
    expect(s).toContain('\n  "format": "composa.manifest/1",')
  })

  it('embeds no layer UUID in place of the sanitized export ids', () => {
    const s = serializeLayerManifest(
      buildLayerManifest(FIXED_STATE, FIXED_SOURCES, FIXED_OPTS),
    )
    // The store `id` field is the UUID identity — but exportId must never
    // leak a raw pattern like an accidental uuid. (Our fixture ids are
    // hand-named, so assert the sanitized ids are what serialize.)
    expect(s).toContain('"exportId": "Hero"')
    expect(s).not.toContain('"exportId": ""')
  })
})
