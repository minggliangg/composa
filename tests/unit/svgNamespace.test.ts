import { describe, it, expect } from 'vitest'
import { namespaceSvgMarkup } from '../../src/export/svgNamespace'

/**
 * Phase 3 export namespacing unit tests.
 *
 * `namespaceSvgMarkup` rewrites every id + reference under a per-layer prefix so
 * two copies of the same logo can coexist in one exported document. Pure and
 * deterministic; assertions are on the returned `inner` markup.
 */

describe('namespaceSvgMarkup — id + reference rewriting', () => {
  it('renames element ids under the prefix', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<defs><linearGradient id="grad1"/></defs>' +
      '<rect id="box" width="10" height="10"/></svg>'
    const { inner } = namespaceSvgMarkup(markup, 'L0')
    expect(inner).toContain('id="L0__grad1"')
    expect(inner).toContain('id="L0__box"')
    expect(inner).not.toMatch(/\bid="grad1"/)
  })

  it('rewrites url(#id) in presentation attributes', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<defs><clipPath id="clip"><rect width="5" height="5"/></clipPath></defs>' +
      '<rect width="10" height="10" clip-path="url(#clip)"/></svg>'
    const { inner } = namespaceSvgMarkup(markup, 'L2')
    expect(inner).toContain('clip-path="url(#L2__clip)"')
  })

  it('rewrites url(#id) and #id selectors inside a <style> block', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<style>#thing { fill: url(#grad); } .c { fill: red; }</style>' +
      '<defs><linearGradient id="grad"/></defs>' +
      '<rect id="thing" width="5" height="5"/>' +
      '<rect class="c" width="5" height="5"/></svg>'
    const { inner } = namespaceSvgMarkup(markup, 'L1')
    expect(inner).toContain('#L1__thing')
    expect(inner).toContain('url(#L1__grad)')
    // class selector + class attribute both scoped.
    expect(inner).toContain('.L1__c')
    expect(inner).toContain('class="L1__c"')
  })

  it('rewrites xlink:href="#id" fragment references', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">' +
      '<defs><symbol id="sym"><rect width="5" height="5"/></symbol></defs>' +
      '<use xlink:href="#sym" width="5" height="5"/></svg>'
    const { inner } = namespaceSvgMarkup(markup, 'L3')
    expect(inner).toContain('xlink:href="#L3__sym"')
  })

  it('rewrites href="#id" (non-xlink) fragment references', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<defs><symbol id="sym"><rect width="5" height="5"/></symbol></defs>' +
      '<use href="#sym" width="5" height="5"/></svg>'
    const { inner } = namespaceSvgMarkup(markup, 'L3')
    expect(inner).toContain('href="#L3__sym"')
  })
})

describe('namespaceSvgMarkup — collision + at-rule handling', () => {
  const logo =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<defs><linearGradient id="g"><stop stop-color="red"/></linearGradient>' +
    '<clipPath id="c"><rect width="12" height="12"/></clipPath></defs>' +
    '<rect width="24" height="24" fill="url(#g)" clip-path="url(#c)"/></svg>'

  it('two identical markups under different prefixes produce no colliding ids', () => {
    const a = namespaceSvgMarkup(logo, 'L1')
    const b = namespaceSvgMarkup(logo, 'L2')
    // Each copy's references point only at its own prefixed ids.
    expect(a.inner).toContain('id="L1__g"')
    expect(a.inner).toContain('url(#L1__g)')
    expect(a.inner).toContain('url(#L1__c)')
    expect(b.inner).toContain('id="L2__g"')
    expect(b.inner).toContain('url(#L2__g)')
    // And neither references the other's prefix.
    expect(a.inner).not.toContain('L2__')
    expect(b.inner).not.toContain('L1__')
  })

  it('drops a <style> block that carries a disallowed at-rule (@import)', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<style>@import url("https://evil/x.css"); .a { fill: red; }</style>' +
      '<rect class="a" width="5" height="5"/></svg>'
    const { inner } = namespaceSvgMarkup(markup, 'L0')
    expect(inner.toLowerCase()).not.toContain('@import')
    expect(inner.toLowerCase()).not.toContain('<style')
    expect(inner.toLowerCase()).not.toContain('evil')
  })

  it('keeps a <style> block with only @media/@supports', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<style>@media (min-width: 0) { .a { fill: red; } }</style>' +
      '<rect class="a" width="5" height="5"/></svg>'
    const { inner } = namespaceSvgMarkup(markup, 'L0')
    expect(inner.toLowerCase()).toContain('@media')
    expect(inner.toLowerCase()).toContain('<style')
    // Class still scoped.
    expect(inner).toContain('.L0__a')
    expect(inner).toContain('class="L0__a"')
  })
})

describe('namespaceSvgMarkup — determinism', () => {
  it('same input + prefix -> byte-identical output', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<defs><linearGradient id="g1"/></defs>' +
      '<rect id="r" class="a b" fill="url(#g1)" width="5" height="5"/></svg>'
    const a = namespaceSvgMarkup(markup, 'L5')
    const b = namespaceSvgMarkup(markup, 'L5')
    expect(a.inner).toBe(b.inner)
    expect(a.viewBox).toBe('0 0 10 10')
  })

  it('returns the source viewBox', () => {
    const markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 3 40 50"><rect/></svg>'
    expect(namespaceSvgMarkup(markup, 'L0').viewBox).toBe('2 3 40 50')
  })
})
