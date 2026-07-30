/**
 * Per-layer id/class namespacing for embedded SVG (the "fancy fox" plan, Phase 3).
 *
 * When two overlays are copies of the same logo (or any two SVGs share ids), the
 * exported document becomes ONE tree: duplicate gradient/clipPath/style ids
 * collide, last-wins, and the render is wrong. `namespaceSvgMarkup` rewrites
 * every `id` and every reference to it under a unique per-layer prefix so the
 * two copies render correctly and identically.
 *
 * Pure and deterministic: same markup + same prefix → byte-identical output
 * (the prefix is the layer's sorted index `L0`, `L1`, …, NOT `layer.id` — ids
 * are `crypto.randomUUID()`, which would destroy `buildSvgDocument`'s byte
 * determinism). DOM parse/serialize only (jsdom-safe), no async, no clock.
 *
 * NOTE: the input is expected to be already SANITIZED (`parseSvgSource`). This
 * module rewrites identifiers; it does not re-sanitize.
 */

export interface NamespacedSvg {
  /** Serialized children of the source `<svg>` root — the nested `<svg>` body. */
  inner: string
  /** The source root's `viewBox` (always present on sanitized markup). */
  viewBox: string
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Does this CSS text contain an at-rule we won't try to rewrite? We drop the
 *  whole `<style>` block in that case (e.g. `@import`, `@font-face` with an
 *  external `src`). `@media` / `@supports` are kept. */
function hasDisallowedAtRule(css: string): boolean {
  const matches = css.match(/@([\w-]+)/g)
  if (!matches) return false
  for (const m of matches) {
    const name = m.slice(1).toLowerCase()
    if (name !== 'media' && name !== 'supports') return true
  }
  return false
}

/**
 * Rewrite `#id` references in a string to `#<prefix>__id` for every known id.
 * Matches the `#`-prefixed id form used by `url(#id)`, `href="#id"`, and CSS id
 * selectors. A trailing identifier boundary `(?![\w-])` avoids partial matches
 * (e.g. `#foo` should not match inside `#foobar`).
 */
function buildHashIdRewriter(
  idMap: Map<string, string>,
): (value: string) => string {
  if (idMap.size === 0) return (s) => s
  // Longest first so `#foo` can't shadow `#foobar` alternation order.
  const ids = [...idMap.keys()].sort((a, b) => b.length - a.length)
  const re = new RegExp(
    '#(' + ids.map(escapeRegExp).join('|') + ')(?![\\w-])',
    'g',
  )
  return (s) => s.replace(re, (_full, id: string) => '#' + idMap.get(id))
}

/**
 * Namespace one SVG layer's markup. Renames every element `id`, every `#id`
 * reference (in presentation attributes, inline `style`, and `<style>` blocks),
 * every `xlink:href="#id"` / `href="#id"`, and scopes class selectors + `class`
 * attributes. Drops `<style>` blocks that carry a disallowed at-rule.
 *
 * Returns `{ inner, viewBox }` where `inner` is the serialized CHILDREN of the
 * source root (the body of the nested `<svg>` the exporter will emit).
 */
export function namespaceSvgMarkup(
  markup: string,
  prefix: string,
): NamespacedSvg {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = doc.documentElement
  // No root / no <svg> → emit nothing (defensive; sanitized input always has it).
  if (!root || root.localName !== 'svg') {
    return { inner: '', viewBox: '' }
  }
  const viewBox = root.getAttribute('viewBox') ?? ''

  // 1. Collect + apply id renames.
  const idMap = new Map<string, string>()
  for (const el of Array.from(root.querySelectorAll('[id]'))) {
    const old = el.getAttribute('id')!
    if (old) idMap.set(old, `${prefix}__${old}`)
  }
  for (const el of Array.from(root.querySelectorAll('[id]'))) {
    const old = el.getAttribute('id')!
    if (old) el.setAttribute('id', idMap.get(old)!)
  }
  const rewriteHashIds = buildHashIdRewriter(idMap)

  // 2. Gather class names from style text + element class attributes, then drop
  //    style blocks with disallowed at-rules (before rewriting survivors).
  const classNames = new Set<string>()
  const styleEls = Array.from(root.querySelectorAll('style'))
  for (const s of styleEls) {
    const text = s.textContent ?? ''
    for (const m of text.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      classNames.add(m[1])
    }
    if (hasDisallowedAtRule(text)) s.remove()
  }
  for (const el of Array.from(root.querySelectorAll('[class]'))) {
    for (const tok of (el.getAttribute('class') ?? '').split(/\s+/)) {
      if (tok) classNames.add(tok)
    }
  }

  // 3. Rewrite surviving <style> text: #id refs and class selectors.
  const rewriteStyle = (text: string): string => {
    let out = rewriteHashIds(text)
    for (const cls of classNames) {
      out = out.replace(
        new RegExp('\\.' + escapeRegExp(cls) + '(?![\\w-])', 'g'),
        `.${prefix}__${cls}`,
      )
    }
    return out
  }
  for (const s of Array.from(root.querySelectorAll('style'))) {
    const rewritten = rewriteStyle(s.textContent ?? '')
    if (rewritten !== (s.textContent ?? '')) s.textContent = rewritten
  }

  // 4. Rewrite attributes on every element (including the root): #id refs
  //    everywhere, plus class-token scoping on `class`.
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'class') {
        const renamed = (attr.value ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .map((tok) => (classNames.has(tok) ? `${prefix}__${tok}` : tok))
          .join(' ')
        if (renamed !== (attr.value ?? '')) el.setAttribute('class', renamed)
        continue
      }
      const rewritten = rewriteHashIds(attr.value)
      if (rewritten !== attr.value) el.setAttribute(attr.name, rewritten)
    }
  }

  // 5. Serialize the root's CHILDREN (the nested <svg> body), not the root.
  //    Serialize the WHOLE root then strip its opening/closing tags: namespace
  //    prefixes bound on the root (e.g. xmlns:xlink) are then inherited by the
  //    children, so `xlink:href` survives serialization (serializing each child
  //    in isolation would lose that context and rename the prefix). The root's
  //    own attributes are simple (xmlns/width/height/viewBox — no '>'), so
  //    tag-boundary slicing is safe; a self-closed root falls back to child
  //    serialization.
  const full = new XMLSerializer().serializeToString(root)
  const openEnd = full.indexOf('>')
  const closeStart = full.lastIndexOf('</svg>')
  const inner =
    openEnd >= 0 && closeStart > openEnd
      ? full.slice(openEnd + 1, closeStart)
      : Array.from(root.childNodes)
          .map((n) => new XMLSerializer().serializeToString(n))
          .join('')
  return { inner, viewBox }
}
