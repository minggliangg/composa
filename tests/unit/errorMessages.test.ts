import { describe, it, expect } from 'vitest'
import { wasmErrorMessage } from '../../src/upload/errorMessages'

/**
 * `wasmErrorMessage` is the single source of user-facing copy for the stable
 * error codes the Rust/WASM layer emits. Pure and synchronous, so it is tested
 * directly without any Worker/WASM machinery.
 */
describe('wasmErrorMessage', () => {
  it('maps the unsupported_format code to readable copy', () => {
    const msg = wasmErrorMessage('unsupported_format')
    expect(msg).toMatch(/PNG, JPEG, GIF, WebP/)
    // Now mentions SVG too (the vector import path).
    expect(msg).toMatch(/SVG/)
  })

  it('maps the svg_parse_failed code to readable copy', () => {
    const msg = wasmErrorMessage('svg_parse_failed')
    expect(msg.length).toBeGreaterThan(0)
    expect(msg).toMatch(/svg/i)
  })

  it('maps the svg_too_large code to readable copy', () => {
    const msg = wasmErrorMessage('svg_too_large')
    expect(msg).toMatch(/large|big/i)
    expect(msg).toMatch(/2 ?mb/i)
  })

  it('maps the decode_failed code to readable copy', () => {
    const msg = wasmErrorMessage('decode_failed')
    expect(msg).toMatch(/corrupt|truncat/i)
  })

  it('maps the dimensions_too_large code to readable copy mentioning the cap', () => {
    const msg = wasmErrorMessage('dimensions_too_large')
    expect(msg).toMatch(/12000/)
    expect(msg.toLowerCase()).toMatch(/too large|too big|larger than/)
  })

  it('returns a sensible default for an unknown code', () => {
    const msg = wasmErrorMessage('something_unexpected')
    expect(msg.length).toBeGreaterThan(0)
    // Must NOT accidentally match one of the known messages.
    expect(msg).not.toBe(wasmErrorMessage('unsupported_format'))
    expect(msg).not.toBe(wasmErrorMessage('decode_failed'))
    expect(msg).not.toBe(wasmErrorMessage('dimensions_too_large'))
  })

  it('returns the same copy for the same code (deterministic)', () => {
    expect(wasmErrorMessage('decode_failed')).toBe(
      wasmErrorMessage('decode_failed'),
    )
  })

  it('produces non-empty copy for every documented code', () => {
    for (const code of [
      'unsupported_format',
      'decode_failed',
      'dimensions_too_large',
      'svg_parse_failed',
      'svg_too_large',
    ] as const) {
      expect(wasmErrorMessage(code).length).toBeGreaterThan(0)
    }
  })
})
