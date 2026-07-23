import { describe, it, expect } from 'vitest'
import { dedupeDisplayNames } from '../../src/upload/filenameDisplay'

/**
 * Phase 09 duplicate-filename display tests.
 *
 * `dedupeDisplayNames` is pure and synchronous — it never mutates the input and
 * only produces DISPLAY labels. The stored `originalFilename` (and therefore
 * export metadata) stays verbatim; these tests assert the label rules from MVP
 * plan §7 ("Duplicate filenames").
 */
describe('dedupeDisplayNames', () => {
  it('returns unique filenames unchanged', () => {
    expect(dedupeDisplayNames(['a.png', 'b.png', 'c.png'])).toEqual([
      'a.png',
      'b.png',
      'c.png',
    ])
  })

  it('keeps the first occurrence and suffixes later collisions with (n)', () => {
    expect(dedupeDisplayNames(['foo.png', 'foo.png', 'foo.png'])).toEqual([
      'foo.png',
      'foo (1).png',
      'foo (2).png',
    ])
  })

  it('inserts the suffix BEFORE the extension, keeping multi-dot names intact', () => {
    // last `.` splits -> base "archive.tar", ext ".gz"
    expect(dedupeDisplayNames(['archive.tar.gz', 'archive.tar.gz'])).toEqual([
      'archive.tar.gz',
      'archive.tar (1).gz',
    ])
  })

  it('only collides on EXACT original-name matches; similar names stay distinct', () => {
    expect(
      dedupeDisplayNames(['foo.png', 'foo (1).png', 'foo.png']),
    ).toEqual(['foo.png', 'foo (1).png', 'foo (1).png'])
  })

  it('handles multiple independent collision groups in the same list', () => {
    expect(
      dedupeDisplayNames([
        'a.png',
        'b.png',
        'a.png',
        'b.png',
        'b.png',
        'a.png',
      ]),
    ).toEqual([
      'a.png',
      'b.png',
      'a (1).png',
      'b (1).png',
      'b (2).png',
      'a (2).png',
    ])
  })

  it('treats an extension-less name as the whole base and appends the suffix', () => {
    expect(dedupeDisplayNames(['README', 'README'])).toEqual([
      'README',
      'README (1)',
    ])
  })

  it('treats a leading-dot dotfile as having no extension', () => {
    expect(dedupeDisplayNames(['.gitignore', '.gitignore'])).toEqual([
      '.gitignore',
      '.gitignore (1)',
    ])
  })

  it('is deterministic: the same input always yields the same labels', () => {
    const input = ['x.png', 'x.png', 'y.webp', 'x.png']
    expect(dedupeDisplayNames(input)).toEqual(dedupeDisplayNames(input))
  })

  it('does not mutate the input array or its strings', () => {
    const input = ['dupe.png', 'dupe.png']
    const snapshot = [...input]
    dedupeDisplayNames(input)
    expect(input).toEqual(snapshot)
  })

  it('handles an empty list', () => {
    expect(dedupeDisplayNames([])).toEqual([])
  })

  it('handles mixed case as distinct names (case-sensitive)', () => {
    // Filenames are case-sensitive on the platforms this MVP targets; we do not
    // normalize case before comparing.
    expect(dedupeDisplayNames(['Foo.png', 'foo.png', 'Foo.png'])).toEqual([
      'Foo.png',
      'foo.png',
      'Foo (1).png',
    ])
  })
})
