import { deflateSync } from 'zlib'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Generates a valid PNG file as a Buffer (truecolor RGB, no external deps) so
 * E2E tests can upload real images via Playwright `setInputFiles` without
 * committing binary fixtures. The pixels are a deterministic solid-ish color
 * pattern; only the dimensions matter for the app's decode/natural-size logic.
 */

const CRC_TABLE: number[] = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcInput = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

/** Build a `width` x `height` PNG (RGB, 8-bit). */
export function pngBuffer(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  ihdr[10] = 0 // compression: deflate
  ihdr[11] = 0 // filter: adaptive
  ihdr[12] = 0 // interlace: none

  // Each scanline is prefixed with a filter byte (0 = none), then width*3 RGB
  // bytes. A solid fill keeps it simple and fully opaque.
  const rowLen = 1 + width * 3
  const raw = Buffer.alloc(rowLen * height)
  for (let y = 0; y < height; y++) {
    const off = y * rowLen
    raw[off] = 0
    for (let x = 0; x < width; x++) {
      const p = off + 1 + x * 3
      raw[p] = 200 // R
      raw[p + 1] = 80 // G
      raw[p + 2] = 80 // B
    }
  }
  const idat = deflateSync(raw)

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A `{name, mimeType, buffer}` triple ready for `setInputFiles`. */
export function pngFile(
  name: string,
  width: number,
  height: number,
): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: 'image/png', buffer: pngBuffer(width, height) }
}

/**
 * Build a `width` x `height` PNG WITH an alpha channel (PNG color type 6 =
 * truecolor + alpha, 8-bit). Pixel (0,0) is fully transparent and the rest are
 * semi-transparent, so the alpha channel provably carries information and the
 * WASM re-encoder cannot optimize it away to RGB. Used by the Phase 09
 * transparent-PNG fidelity E2E test.
 */
export function transparentPngBuffer(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: truecolor + alpha (RGBA)
  ihdr[10] = 0 // compression: deflate
  ihdr[11] = 0 // filter: adaptive
  ihdr[12] = 0 // interlace: none

  // Each scanline: filter byte (0 = none) + width*4 RGBA bytes.
  const rowLen = 1 + width * 4
  const raw = Buffer.alloc(rowLen * height)
  for (let y = 0; y < height; y++) {
    const off = y * rowLen
    raw[off] = 0
    for (let x = 0; x < width; x++) {
      const p = off + 1 + x * 4
      const fullyTransparent = x === 0 && y === 0
      raw[p] = 200 // R
      raw[p + 1] = 80 // G
      raw[p + 2] = 80 // B
      raw[p + 3] = fullyTransparent ? 0 : 180 // A
    }
  }
  const idat = deflateSync(raw)

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Transparent RGBA PNG as a `{name, mimeType, buffer}` triple. */
export function transparentPngFile(
  name: string,
  width: number,
  height: number,
): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: 'image/png', buffer: transparentPngBuffer(width, height) }
}

/**
 * Shared E2E setup: load the app, upload a base image (sets the canvas), wait
 * for it to render, then upload one overlay and wait for its `<image>` to
 * appear. Returns locators + the overlay's initial canvas-unit rect read from
 * the rendered `<image>` attributes.
 */
export async function setupBaseAndOverlay(
  page: Page,
  baseW: number,
  baseH: number,
  overlayW: number,
  overlayH: number,
): Promise<{
  overlayImage: ReturnType<Page['locator']>
  rect: () => Promise<{
    x: number
    y: number
    width: number
    height: number
  }>
}> {
  await page.goto('/')
  const fileInputs = page.locator('input[type="file"]')
  await fileInputs
    .nth(0)
    .setInputFiles(pngFile('base.png', baseW, baseH))
  // Base decoded -> canvas <svg> mounts.
  await page.locator('svg[role="img"]').waitFor()
  // Overlay input enables once a base exists.
  await expect(fileInputs.nth(1)).toBeEnabled()
  await fileInputs
    .nth(1)
    .setInputFiles(pngFile('overlay.png', overlayW, overlayH))

  const overlayImage = page.locator('g[data-role="overlay"] image')
  await overlayImage.waitFor()

  const rect = async () => ({
    x: Number(await overlayImage.getAttribute('x')),
    y: Number(await overlayImage.getAttribute('y')),
    width: Number(await overlayImage.getAttribute('width')),
    height: Number(await overlayImage.getAttribute('height')),
  })

  return { overlayImage, rect }
}
