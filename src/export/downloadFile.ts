/**
 * Trigger a browser download for a Blob by spinning up a temporary
 * `<a download>` element, clicking it, then tearing it down.
 *
 * The object URL is revoked immediately after the click dispatches — the
 * browser has already navigated to the blob by then, so revoking right away is
 * safe and avoids leaking the URL. (Holding it on a timeout would also work
 * but adds nothing for a programmatic click.)
 *
 * Runs against the live DOM; not part of the pure/deterministic build path.
 */
export function downloadFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.download = filename
  anchor.href = url
  // The element must live in the document for the click to trigger a download
  // in some browsers; keep it invisible and out of layout.
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
