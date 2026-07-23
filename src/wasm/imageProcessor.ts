/**
 * Typed main-thread proxy around the Rust/WASM `image-processor` crate.
 *
 * All actual WASM work runs inside the Web Worker (`worker.ts`); this module
 * owns the single lazy Worker singleton and exposes Promise-returning methods
 * that correlate each request/response by a numeric `id`. Callers never touch
 * `postMessage` directly.
 *
 * The worker returns PNG preview bytes as a transferable `Uint8Array`; this
 * proxy wraps them into a `Blob` (ready for `URL.createObjectURL`) so the rest
 * of the app deals only with blobs + natural dimensions.
 *
 * Errors: when the worker reports `{type:'error', code}`, the matching promise
 * rejects with an `Error` whose `.message` is the stable code string (e.g.
 * 'unsupported_format'). Callers map that to user copy via
 * `wasmErrorMessage(code)` — keeping presentation out of this layer.
 */

/** Lazy singleton — created on first use, reused for the app's lifetime. */
let worker: Worker | null = null

/** Monotonic request id used to correlate worker responses. */
let nextId = 1

/**
 * Pending-request map: id -> { resolve, reject }. Entries exist only between
 * dispatching a request and receiving its reply, so this never grows large.
 */
const pending = new Map<
  number,
  {
    resolve: (value: WorkerReplyPayload) => void
    reject: (err: Error) => void
  }
>()

/**
 * Reply payloads for the successful paths. Error replies are handled uniformly
 * (promise rejection) and don't appear here.
 */
export type WorkerReplyPayload =
  | { type: 'probe'; result: { width: number; height: number } }
  | { type: 'decode'; bytes: Uint8Array<ArrayBuffer> }
  | { type: 'reencode'; dataUri: string }

/** Lazily instantiate the worker exactly once. */
function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.onmessage = (e: MessageEvent) => {
    const reply = e.data as
      | (WorkerReplyPayload & { id: number })
      | { type: 'error'; id: number; code: string }
    const entry = pending.get(reply.id)
    if (!entry) return
    pending.delete(reply.id)
    if (reply.type === 'error') {
      entry.reject(new Error(reply.code))
      return
    }
    // Strip the correlating `id` before handing the payload to the caller.
    if (reply.type === 'probe') {
      entry.resolve({ type: 'probe', result: reply.result })
    } else if (reply.type === 'decode') {
      entry.resolve({ type: 'decode', bytes: reply.bytes })
    } else {
      entry.resolve({ type: 'reencode', dataUri: reply.dataUri })
    }
  }
  worker.onerror = (e: ErrorEvent) => {
    // A worker-level error (e.g. failure to load the module) means no future
    // request can succeed either; reject every pending promise and drop the
    // dead worker so the next call re-creates it.
    const err = new Error(e.message || 'Image worker failed to load')
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
    worker = null
  }
  return worker
}

/**
 * Post a request to the worker and return a promise that resolves with the
 * typed reply payload, or rejects with an `Error` whose `.message` is the
 * stable WASM error code.
 */
function dispatch(request: {
  type: 'probe' | 'decode' | 'reencode'
  file: File
  maxDim?: number
}): Promise<WorkerReplyPayload> {
  const id = nextId++
  const message =
    request.type === 'decode'
      ? { type: 'decode', id, file: request.file, maxDim: request.maxDim! }
      : { type: request.type, id, file: request.file }
  return new Promise<WorkerReplyPayload>((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => resolve(v),
      reject: (err) => reject(err),
    })
    getWorker().postMessage(message)
  })
}

/**
 * Sniff the image format via WASM magic-byte detection and return the natural
 * pixel dimensions. This is the authoritative dimension source (the declared
 * MIME/extension can lie). Enforces `MAX_SOURCE_DIMENSION` on the Rust side.
 */
export async function probeDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  const reply = await dispatch({ type: 'probe', file })
  if (reply.type !== 'probe') {
    throw new Error('decode_failed')
  }
  return reply.result
}

/**
 * Decode the image in the worker, downscale so the larger side equals `maxDim`
 * (never upscales; smaller inputs are returned at original size), preserve
 * alpha, and return the result as a PNG `Blob` ready for `URL.createObjectURL`.
 */
export async function decodeAndDownscale(
  file: File,
  maxDim: number,
): Promise<Blob> {
  const reply = await dispatch({ type: 'decode', file, maxDim })
  if (reply.type !== 'decode') {
    throw new Error('decode_failed')
  }
  return new Blob([reply.bytes], { type: 'image/png' })
}

/**
 * Decode + re-encode the full-resolution original as a PNG `data:` URI
 * (format normalized, alpha preserved, EXIF/ICC stripped). Phase 08 (SVG
 * export) consumes this; it is exposed now so that phase needs no proxy change.
 */
export async function reencodeOriginal(file: File): Promise<string> {
  const reply = await dispatch({ type: 'reencode', file })
  if (reply.type !== 'reencode') {
    throw new Error('decode_failed')
  }
  return reply.dataUri
}
