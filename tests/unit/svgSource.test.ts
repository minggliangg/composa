import { describe, it, expect } from 'vitest'
import {
  parseSvgSource,
  resolveSvgDimensions,
  MAX_SVG_BYTES,
  DEFAULT_SVG_SIZE,
} from '../../src/upload/svgSource'

/**
 * Phase 1 SVG import unit tests.
 *
 * `resolveSvgDimensions` is pure table math. `parseSvgSource` parses +
 * sanitizes via DOMParser/XMLSerializer (both jsdom-available), so it is tested
 * directly against the dimension precedence matrix and a sanitizer checklist.
 */

describe('resolveSvgDimensions — precedence matrix', () => {
  it('uses absolute px width/height when both present', () => {
    expect(resolveSvgDimensions('100', '50', null)).toEqual({
      width: 100,
      height: 50,
    })
  })

  it('converts pt -> px at 96 dpi (72pt = 96px)', () => {
    expect(resolveSvgDimensions('72pt', '36pt', null)).toEqual({
      width: 96,
      height: 48,
    })
  })

  it('converts in/cm/mm units', () => {
    // 1in = 96px; 1cm = 96/2.54 ≈ 37.795
    expect(resolveSvgDimensions('1in', '1cm', null)).toEqual({
      width: 96,
      height: 96 / 2.54,
    })
  })

  it('falls back to the viewBox when width/height are percentages', () => {
    expect(resolveSvgDimensions('50%', '50%', '0 0 200 100')).toEqual({
      width: 200,
      height: 100,
    })
  })

  it('uses the viewBox when dims are missing entirely (viewBox-only)', () => {
    expect(resolveSvgDimensions(null, null, '0 0 300 150')).toEqual({
      width: 300,
      height: 150,
    })
  })

  it('derives the missing side from the viewBox aspect (one dim + viewBox)', () => {
    // width=100, viewBox 200x100 → aspect 2:1 → height = 100/2 = 50.
    expect(resolveSvgDimensions('100', null, '0 0 200 100')).toEqual({
      width: 100,
      height: 50,
    })
    // height=100, viewBox 200x100 → width = 100*2 = 200.
    expect(resolveSvgDimensions(null, '100', '0 0 200 100')).toEqual({
      width: 200,
      height: 100,
    })
  })

  it('falls back to the default square when neither dims nor a viewBox exist', () => {
    expect(resolveSvgDimensions(null, null, null)).toEqual({
      width: DEFAULT_SVG_SIZE,
      height: DEFAULT_SVG_SIZE,
    })
  })
})

describe('parseSvgSource — happy path', () => {
  it('returns sanitized markup + synthesized viewBox for a minimal svg', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48"/></svg>',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.naturalWidth).toBe(64)
    expect(result.naturalHeight).toBe(48)
    expect(result.viewBox).toBe('0 0 64 48')
    // Round-trips through a parser as valid SVG.
    const doc = new DOMParser().parseFromString(result.markup, 'image/svg+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.documentElement.localName).toBe('svg')
  })

  it('synthesizes a viewBox when the source lacks one', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.viewBox).toBe('0 0 32 32')
  })

  it('keeps an existing viewBox untouched', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50" width="100" height="50"/>',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.viewBox).toBe('10 20 100 50')
  })

  it('derives intrinsic size from the viewBox when there are no width/height', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 128"/>',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.naturalWidth).toBe(256)
    expect(result.naturalHeight).toBe(128)
  })
})

describe('parseSvgSource — sanitizer', () => {
  function bodyOf(markup: string): string {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
    return doc.documentElement.outerHTML
  }

  it('removes <script> elements', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<script>alert(1)</script><rect width="10" height="10"/></svg>',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(bodyOf(result.markup).toLowerCase()).not.toContain('<script')
    expect(bodyOf(result.markup).toLowerCase()).not.toContain('alert')
  })

  it('removes <foreignObject> and other non-allow-listed elements', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<foreignObject width="10" height="10"><div>x</div></foreignObject>' +
        '<set attributeName="x" to="5"/>' +
        '<rect width="10" height="10"/></svg>',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lower = bodyOf(result.markup).toLowerCase()
    expect(lower).not.toContain('foreignobject')
    expect(lower).not.toContain('<set')
  })

  it('keeps fe* filter primitives', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<filter id="f"><feGaussianBlur stdDeviation="2"/></filter>' +
        '<rect width="10" height="10" filter="url(#f)"/></svg>',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(bodyOf(result.markup).toLowerCase()).toContain('fegaussianblur')
  })

  it('strips on* event-handler attributes', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<rect width="10" height="10" onclick="alert(1)" onload="x()"/></svg>',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(bodyOf(result.markup).toLowerCase()).not.toContain('onclick')
    expect(bodyOf(result.markup).toLowerCase()).not.toContain('onload')
  })

  it('drops external href but keeps fragment + data:image href', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<use href="#sym"/>' +
        '<image href="https://evil.example/x.png" width="1" height="1"/>' +
        '<image href="data:image/png;base64,AAAA" width="1" height="1"/></svg>',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lower = bodyOf(result.markup).toLowerCase()
    expect(lower).toContain('href="#sym"')
    expect(lower).not.toContain('evil.example')
    expect(lower).toContain('data:image/png;base64,aaaa')
  })

  it('drops javascript: URLs in attribute values', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<a href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The <a> element isn't allow-listed → removed wholesale; either way the
    // javascript: scheme must not survive.
    expect(bodyOf(result.markup).toLowerCase()).not.toContain('javascript:')
  })

  it('scrubs disallowed url() references but keeps url(#…) and url(data:…)', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<defs><linearGradient id="g"/></defs>' +
        '<rect width="5" height="5" fill="url(http://evil/x)"/>' +
        '<rect width="5" height="5" fill="url(#g)"/></svg>',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lower = bodyOf(result.markup).toLowerCase()
    expect(lower).not.toContain('evil')
    expect(lower).toContain('url(#g)')
  })
})

describe('parseSvgSource — failure modes', () => {
  it('rejects oversize text with svg_too_large', () => {
    const huge = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">' + 'x'.repeat(MAX_SVG_BYTES) + '</svg>'
    const result = parseSvgSource(huge)
    expect(result).toEqual({ ok: false, reason: 'svg_too_large' })
  })

  it('rejects a dimension over the cap with dimensions_too_large', () => {
    const result = parseSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"/>',
    )
    expect(result).toEqual({ ok: false, reason: 'dimensions_too_large' })
  })

  it('rejects malformed XML with svg_parse_failed', () => {
    const result = parseSvgSource('<svg><rect width="10"</svg>')
    expect(result).toEqual({ ok: false, reason: 'svg_parse_failed' })
  })

  it('rejects non-svg XML with svg_parse_failed', () => {
    const result = parseSvgSource(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body>hi</body></html>',
    )
    expect(result).toEqual({ ok: false, reason: 'svg_parse_failed' })
  })

  it('rejects plain text with svg_parse_failed', () => {
    const result = parseSvgSource('this is not svg at all')
    expect(result).toEqual({ ok: false, reason: 'svg_parse_failed' })
  })
})
