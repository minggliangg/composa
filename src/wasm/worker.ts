/**
 * Web Worker entry point for image processing.
 *
 * Owns its OWN WASM module instance — wasm instances/`WebAssembly.Memory` are
 * NOT transferable across threads, so the worker must initialize the module
 * itself rather than receiving one from the main thread. The heavy decode /
 * downscale / re-encode work runs here, off the UI thread, so the canvas and
 * panels stay responsive even while a large image is being processed.
 *
 * Initialization model: the module evaluates SYNCHRONOUSLY (no top-level
 * await) so the message listener is registered the instant the worker starts,
 * and no posted message is ever dropped. The WASM module is initialized lazily
 * on the first request via a shared `ready` promise — subsequent requests
 * reuse the already-initialized instance. (Top-level `await init()` in a Vite
 * dev module worker delays listener registration past the message queue and
 * loses the first request; lazy init sidesteps that entirely and is also how
 * the wasm-pack docs recommend structuring on-demand init.)
 *
 * Message protocol (request `id` correlates every response):
 *
 *   main -> worker:
 *     { type: 'probe',    id, file }
 *     { type: 'decode',   id, file, maxDim }
 *     { type: 'reencode', id, file }
 *
 *   worker -> main:
 *     { type: 'probe',    id, result: { width, height } }
 *     { type: 'decode',   id, bytes: Uint8Array }   // PNG bytes; buffer transferred
 *     { type: 'reencode', id, dataUri: string }
 *     { type: 'error',    id, code: string }         // stable WASM error code
 *
 * Errors: the wasm functions throw the raw code STRING (e.g.
 * 'unsupported_format') on `Err`, not an Error instance — we normalize that
 * here and always reply with an `{type:'error'}` message so the worker never
 * dies silently on a bad input.
 */

/// <reference lib="webworker" />

import init from './pkg/image_processor.js'
import {
  init_panic_hook,
  probe_dimensions,
  decode_and_downscale,
  reencode_original,
} from './pkg/image_processor.js'

/** A request from the main thread. */
type WorkerRequest =
  | { type: 'probe'; id: number; file: File }
  | { type: 'decode'; id: number; file: File; maxDim: number }
  | { type: 'reencode'; id: number; file: File }

/** Reply helper: post a message back to the main thread from this worker. */
const post = (msg: unknown, transfer?: Transferable[]): void => {
  // Dispatch on `transfer` presence so TS picks the right `postMessage`
  // overload (transfer list vs. serialize-options) — passing `undefined`
  // positionally would resolve to the options overload and type-error.
  if (transfer) {
    ;(self as DedicatedWorkerGlobalScope).postMessage(msg, transfer)
  } else {
    ;(self as DedicatedWorkerGlobalScope).postMessage(msg)
  }
}

/**
 * Coerce a thrown wasm error into its stable code string. The generated
 * bindings throw the code as a bare JS string (`JsValue::from_str`), but we
 * guard against Error objects / unknown values too so a future binding change
 * can't produce an undefined code.
 */
function errorCode(err: unknown): string {
  if (typeof err === 'string') return err
  if (err instanceof Error && err.message) return err.message
  return 'decode_failed'
}

/**
 * Lazily-initialized WASM readiness. The first request kicks off `init()` +
 * the panic hook; every request awaits the same promise so init runs exactly
 * once even if several files land concurrently.
 */
let ready: Promise<void> | null = null
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await init()
      init_panic_hook()
    })()
  }
  return ready
}

/** Handle a single request and post the matching reply. */
async function handleMessage(req: WorkerRequest): Promise<void> {
  try {
    await ensureReady()
    if (req.type === 'probe') {
      const bytes = new Uint8Array(await req.file.arrayBuffer())
      const dims = probe_dimensions(bytes)
      post({
        type: 'probe',
        id: req.id,
        result: { width: Number(dims[0]), height: Number(dims[1]) },
      })
      return
    }

    if (req.type === 'decode') {
      const bytes = new Uint8Array(await req.file.arrayBuffer())
      const png = decode_and_downscale(bytes, req.maxDim)
      // Transfer the underlying buffer (zero-copy): the `.slice()` the wasm
      // bindings apply means `png` owns its buffer, so detaching it here is
      // safe and frees the worker from holding a second copy.
      post({ type: 'decode', id: req.id, bytes: png }, [png.buffer])
      return
    }

    if (req.type === 'reencode') {
      const bytes = new Uint8Array(await req.file.arrayBuffer())
      const dataUri = reencode_original(bytes)
      post({ type: 'reencode', id: req.id, dataUri })
      return
    }
  } catch (err) {
    post({ type: 'error', id: req.id, code: errorCode(err) })
  }
}

// Registered synchronously at module load (no top-level await) so no message
// is ever dropped. `addEventListener` (not `self.onmessage =`) can't be
// clobbered by Vite's worker HMR bookkeeping in dev.
self.addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  if (!req || typeof req !== 'object') return
  void handleMessage(req)
})
