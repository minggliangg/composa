/**
 * Collect the @font-face entries an export needs and resolve their woff2 bytes
 * to base64 data URIs (Step 9).
 *
 * Only the styles a text layer actually uses are embedded: the normal face when
 * any text layer exists, plus the italic face only when some text layer is
 * italic. Two files total regardless of weight/size, which is why the variable
 * package is preferred over the static one.
 *
 * The woff2 is resolved through a LAZY `await import('…?url')` rather than a
 * static import: `exportGuards.test.ts` imports `exportComposition` (and thus
 * this module's exported function) at module scope, and a static `?url` import
 * would be evaluated in jsdom. The lazy form defers resolution to the real
 * browser export path. A module-level cache memoizes each resolved face.
 */
import type { Layer } from '../types/layer'

export interface EmbeddedFontFace {
  style: 'normal' | 'italic'
  /** Full `data:font/woff2;base64,…` URI for the `src: url(...)` descriptor. */
  dataUri: string
}

const cache = new Map<'normal' | 'italic', EmbeddedFontFace>()

/** Base64-encode a byte array in browser-safe chunks (avoids call-stack limits
 *  on the ~18–19 KB woff2 files). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** Lazily import a woff2, fetch it, and base64-encode it once (cached). */
async function loadFontFace(
  style: 'normal' | 'italic',
): Promise<EmbeddedFontFace> {
  const cached = cache.get(style)
  if (cached) return cached
  const specifier =
    style === 'italic'
      ? '@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-wght-italic.woff2?url'
      : '@fontsource-variable/atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-wght-normal.woff2?url'
  const mod = (await import(specifier)) as { default: string }
  const res = await fetch(mod.default)
  const buf = new Uint8Array(await res.arrayBuffer())
  const face: EmbeddedFontFace = {
    style,
    dataUri: `data:font/woff2;base64,${bytesToBase64(buf)}`,
  }
  cache.set(style, face)
  return face
}

/**
 * Resolve the font faces an export of `layers` requires. Returns `[]` when there
 * is no text layer (so no `<defs>` is emitted); otherwise the normal face, plus
 * the italic face only if some text layer is italic.
 */
export async function collectFontFaces(
  layers: Layer[],
): Promise<EmbeddedFontFace[]> {
  let hasText = false
  let wantsItalic = false
  for (const l of layers) {
    if (l.fullResBytesRef.kind === 'text') {
      hasText = true
      if (l.fullResBytesRef.text.italic) wantsItalic = true
    }
  }
  if (!hasText) return []
  const faces: EmbeddedFontFace[] = [await loadFontFace('normal')]
  if (wantsItalic) faces.push(await loadFontFace('italic'))
  return faces
}

/** Clear the resolved-face cache (tests / session reset). */
export function clearFontFaceCache(): void {
  cache.clear()
}
