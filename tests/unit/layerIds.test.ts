import { describe, it, expect } from 'vitest'
import {
  sanitizeSvgId,
  assignLayerIds,
  idSourceLabel,
} from '../../src/export/layerIds'
import type { Layer } from '../../src/types/layer'
import { createLayerId } from '../../src/types/layer'

/**
 * Pure unit tests for the exported-id assignment (Step 2). `sanitizeSvgId`
 * folds a label into an NCName; `assignLayerIds` dedupes in z order and escapes
 * the nested-SVG namespace pattern. Neither touches the DOM.
 */

function layer(partial: Partial<Layer>): Layer {
  const id = partial.id ?? createLayerId()
  return {
    id,
    originalFilename: 'x.png',
    name: null,
    mimeType: 'image/png',
    previewUrl: `blob:${id}`,
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

describe('sanitizeSvgId', () => {
  it('keeps a simple name unchanged', () => {
    expect(sanitizeSvgId('hero')).toBe('hero')
  })

  it('keeps dots and hyphens inside the name', () => {
    expect(sanitizeSvgId('hero.png')).toBe('hero.png')
    expect(sanitizeSvgId('v1.2-hero')).toBe('v1.2-hero')
  })

  it('collapses runs of separators / punctuation to a single hyphen', () => {
    // 'photo & friends.png' — ' & ' (space-&-space) -> one '-'.
    expect(sanitizeSvgId('photo & friends.png')).toBe('photo-friends.png')
  })

  it('prefixes a leading digit with _ (NCName must not start with a digit)', () => {
    expect(sanitizeSvgId('2024 hero')).toBe('_2024-hero')
  })

  it('folds non-ASCII characters to hyphens', () => {
    // 'é' is outside the allowed set -> collapses to '-' then trailing-trimmed.
    expect(sanitizeSvgId('café')).toBe('caf')
  })

  it('prefixes a leading dot with _', () => {
    expect(sanitizeSvgId('.gitignore')).toBe('_.gitignore')
  })

  it('returns "" for an empty or all-separator label', () => {
    expect(sanitizeSvgId('')).toBe('')
    expect(sanitizeSvgId('   ')).toBe('')
    expect(sanitizeSvgId('!!!')).toBe('')
  })
})

describe('idSourceLabel', () => {
  it('prefers a custom name', () => {
    expect(idSourceLabel(layer({ name: 'hero', originalFilename: 'x.png' }))).toBe(
      'hero',
    )
  })
  it('falls back to the original filename', () => {
    expect(idSourceLabel(layer({ name: null, originalFilename: 'logo.svg' }))).toBe(
      'logo.svg',
    )
  })
})

describe('assignLayerIds', () => {
  it('assigns sanitized ids iterating in ascending z-index order', () => {
    const ids = assignLayerIds([
      layer({ id: 'b', name: 'base', zIndex: 0, isBaseImage: true }),
      layer({ id: 'a', name: 'alpha', zIndex: 2 }),
      layer({ id: 'm', name: 'mid', zIndex: 1 }),
    ])
    // Sorted z: base(0), mid(1), alpha(2).
    expect(ids.get('b')).toBe('base')
    expect(ids.get('m')).toBe('mid')
    expect(ids.get('a')).toBe('alpha')
  })

  it('dedupes identical labels with -2, -3 in z order', () => {
    const ids = assignLayerIds([
      layer({ id: 'x', name: 'hero', zIndex: 1 }),
      layer({ id: 'y', name: 'hero', zIndex: 2 }),
      layer({ id: 'z', name: 'hero', zIndex: 3 }),
    ])
    expect(ids.get('x')).toBe('hero')
    expect(ids.get('y')).toBe('hero-2')
    expect(ids.get('z')).toBe('hero-3')
  })

  it('falls back to layer-<index> for an empty sanitized label', () => {
    const ids = assignLayerIds([
      layer({ id: 'base', name: null, originalFilename: 'bg.png', zIndex: 0 }),
      layer({ id: 'empty', name: '   ', zIndex: 1 }),
    ])
    // index 1 (second in z order) -> layer-1.
    expect(ids.get('empty')).toBe('layer-1')
  })

  it('escapes a user name matching the nested-SVG namespace pattern L\\d+__', () => {
    const ids = assignLayerIds([layer({ id: 'sneaky', name: 'L1__g1', zIndex: 1 })])
    expect(ids.get('sneaky')).toBe('_L1__g1')
  })

  it('never produces a duplicate id (a later label equal to an assigned suffix still dedupes)', () => {
    // Two layers named 'hero' -> 'hero', 'hero-2'; a third named 'hero 2' also
    // sanitizes to 'hero-2' and must NOT collide with the assigned suffix.
    const ids = assignLayerIds([
      layer({ id: 'a', name: 'hero', zIndex: 1 }),
      layer({ id: 'b', name: 'hero', zIndex: 2 }),
      layer({ id: 'c', name: 'hero 2', zIndex: 3 }),
    ])
    const values = [...ids.values()]
    expect(new Set(values).size).toBe(values.length) // all unique
    expect(ids.get('a')).toBe('hero')
    expect(ids.get('b')).toBe('hero-2')
  })

  it('is stable: the same layer set yields identical ids across calls', () => {
    const input = [
      layer({ id: 'p', name: 'logo.svg', zIndex: 1 }),
      layer({ id: 'q', name: 'logo.svg', zIndex: 2 }),
    ]
    expect([...assignLayerIds(input).values()]).toEqual([
      ...assignLayerIds(input).values(),
    ])
  })
})
