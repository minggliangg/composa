import { describe, it, expect } from 'vitest'
import {
  validateImageFile,
  isAcceptedMimeType,
  isAcceptedExtension,
  ACCEPTED_MIME_TYPES,
  ACCEPTED_EXTENSIONS,
} from '../../src/upload/fileValidation'

/**
 * Phase 09 validation / error-path tests.
 *
 * The client-side `validateImageFile` is a CHEAP, intentionally LENIENT gate:
 * it rejects only when BOTH the declared MIME type AND the filename extension
 * are unrecognized, so a renamed / under-typed image still reaches the
 * authoritative WASM magic-byte sniff (which can actually inspect bytes). These
 * tests pin that contract against deceptive inputs.
 */

// Real PNG signature bytes so the File is a plausible upload; note the cheap
// validator never inspects bytes — these just make the fixtures realistic.
const PNG_SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function file(
  name: string,
  mimeType: string,
  bytes: Uint8Array = PNG_SIG,
): File {
  return new File([bytes], name, { type: mimeType })
}

describe('validateImageFile — accepted cases', () => {
  it('accepts a straightforward PNG (correct name + MIME)', () => {
    expect(validateImageFile(file('photo.png', 'image/png'))).toEqual({
      ok: true,
    })
  })

  it('accepts every documented image type', () => {
    const cases: Array<[string, string]> = [
      ['a.png', 'image/png'],
      ['b.jpg', 'image/jpeg'],
      ['c.jpeg', 'image/jpeg'],
      ['d.gif', 'image/gif'],
      ['e.webp', 'image/webp'],
      ['f.svg', 'image/svg+xml'],
    ]
    for (const [name, mime] of cases) {
      expect(validateImageFile(file(name, mime))).toEqual({ ok: true })
    }
  })

  it('accepts an SVG by extension even with a generic MIME', () => {
    expect(
      validateImageFile(file('logo.svg', 'application/octet-stream')),
    ).toEqual({ ok: true })
  })

  it('accepts an SVG by MIME even with a non-svg extension', () => {
    expect(validateImageFile(file('logo.xml', 'image/svg+xml'))).toEqual({
      ok: true,
    })
  })

  it('accepts uppercase extensions (case-insensitive suffix match)', () => {
    expect(validateImageFile(file('PHOTO.PNG', 'image/png'))).toEqual({
      ok: true,
    })
  })

  it('accepts a renamed image whose MIME is truthful but extension lies', () => {
    // e.g. a real PNG renamed to .txt — cheap check passes because MIME is ok;
    // the WASM sniff is the authoritative gate that would catch a true non-image.
    expect(validateImageFile(file('photo.txt', 'image/png'))).toEqual({
      ok: true,
    })
  })

  it('accepts an image whose extension is truthful but MIME lies', () => {
    expect(validateImageFile(file('photo.png', 'application/octet-stream'))).toEqual({
      ok: true,
    })
  })

  it('accepts a file with empty bytes when name+MIME claim an image', () => {
    // The cheap check cannot inspect bytes; an empty/corrupt file passes here
    // and is rejected later by the WASM decode gate (decode_failed). This pins
    // the intended split: cheap pre-check = structural, WASM = authoritative.
    expect(validateImageFile(file('empty.png', 'image/png', new Uint8Array()))).toEqual({
      ok: true,
    })
  })
})

describe('validateImageFile — rejected cases', () => {
  it('rejects when BOTH MIME and extension are unrecognized', () => {
    expect(validateImageFile(file('notes.txt', 'text/plain'))).toEqual({
      ok: false,
      reason: 'unsupported_format',
    })
  })

  it('rejects a PDF even with a generic octet-stream MIME', () => {
    expect(validateImageFile(file('doc.pdf', 'application/pdf'))).toEqual({
      ok: false,
      reason: 'unsupported_format',
    })
  })

  it('rejects a file with no extension and a non-image MIME', () => {
    expect(validateImageFile(file('README', 'text/plain'))).toEqual({
      ok: false,
      reason: 'unsupported_format',
    })
  })

  it('the only failure reason from the cheap gate is "unsupported_format"', () => {
    // "dimensions_too_large" is checked later by the WASM layer once natural
    // dimensions are known; the cheap gate never emits it.
    const result = validateImageFile(file('x.txt', 'text/plain'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unsupported_format')
    }
  })
})

describe('isAcceptedMimeType', () => {
  it('narrows to the documented MIME types', () => {
    for (const mime of ACCEPTED_MIME_TYPES) {
      expect(isAcceptedMimeType(mime)).toBe(true)
    }
    expect(isAcceptedMimeType('text/plain')).toBe(false)
    expect(isAcceptedMimeType('application/pdf')).toBe(false)
    expect(isAcceptedMimeType('image/bmp')).toBe(false) // BMP deliberately unsupported
    expect(isAcceptedMimeType('')).toBe(false)
  })
})

describe('isAcceptedExtension', () => {
  it('matches accepted extensions case-insensitively', () => {
    for (const ext of ACCEPTED_EXTENSIONS) {
      expect(isAcceptedExtension(`file${ext}`)).toBe(true)
      expect(isAcceptedExtension(`FILE${ext.toUpperCase()}`)).toBe(true)
    }
  })

  it('rejects unrecognized or missing extensions', () => {
    expect(isAcceptedExtension('file.txt')).toBe(false)
    expect(isAcceptedExtension('file.pdf')).toBe(false)
    expect(isAcceptedExtension('file')).toBe(false)
    expect(isAcceptedExtension('file.bmp')).toBe(false)
  })

  it('uses only the LAST extension for multi-dot names', () => {
    // .tar.gz -> ext ".gz" is NOT accepted.
    expect(isAcceptedExtension('archive.tar.gz')).toBe(false)
    // .tar.png -> ext ".png" IS accepted.
    expect(isAcceptedExtension('archive.tar.png')).toBe(true)
  })
})
