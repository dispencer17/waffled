// openWakeWord in the browser (fork) — account-free wake word via onnxruntime-web.
//
// Pipeline (mirrors github.com/dscripka/openWakeWord, Apache-2.0): 16 kHz PCM in
// 1280-sample (80 ms) chunks → melspectrogram model (8 frames × 32 mels per chunk,
// transformed x/10+2) → Google speech-embedding model over a sliding 76-frame
// window stepped every 8 frames → 96-dim embeddings → wakeword head over the last
// 16 embeddings → sigmoid score. Feasibility + latency were probed headless
// (2026-07-21): mel ≈ 1 ms per 80 ms chunk, emb ≈ 7 ms, head ≈ 3 ms — well under
// real time on WASM. EXPERIMENTAL: real-microphone verification still pending
// (headless environments have no mic) — flagged in Settings copy and docs.
//
// The OwwDetector below holds all buffering/threshold logic with the three model
// runners injected, so it unit-tests without WASM. createOrtRunners() binds the
// real onnxruntime-web sessions, lazy-loaded only when the engine starts.

export const MEL_FRAMES_PER_CHUNK = 8
export const EMB_WINDOW_FRAMES = 76
export const EMB_STEP_FRAMES = 8
export const WAKE_CONTEXT = 16
const CHUNK_SAMPLES = 1280
const N_MELS = 32
const EMB_DIM = 96

export interface ModelOutput {
  dims: number[]
  data: Float32Array<ArrayBufferLike>
}
export type ModelRunner = (input: Float32Array<ArrayBufferLike>) => Promise<ModelOutput>

export interface OwwDetectorOpts {
  runMel: ModelRunner
  runEmb: ModelRunner
  runWake: ModelRunner
  onWake: (score: number) => void
  /** Sigmoid score that counts as a detection (openWakeWord default ballpark). */
  threshold?: number
  /** Chunks (80 ms each) to ignore after a fire; default 25 = 2 s. */
  refractoryChunks?: number
}

export class OwwDetector {
  private readonly opts: Required<OwwDetectorOpts>
  private pcm: Float32Array<ArrayBufferLike> = new Float32Array(0) // sub-chunk carry buffer
  private melFrames: Float32Array[] = [] // each N_MELS long, transformed
  private melConsumed = 0 // frames already used as a window start
  private embeddings: Float32Array[] = []
  private refractory = 0
  private busy = false

  constructor(opts: OwwDetectorOpts) {
    this.opts = { threshold: 0.5, refractoryChunks: 25, ...opts }
  }

  /** Feed raw mic samples (Int16 or float in int16 range), any frame size. */
  async process(frame: Int16Array | Float32Array): Promise<void> {
    // Serialize: model runs are async and mic frames keep arriving.
    if (this.busy) {
      // Coalesce: append to the carry buffer and let the active pass pick it up.
      this.pcm = concat(this.pcm, toFloat(frame))
      return
    }
    this.busy = true
    try {
      this.pcm = concat(this.pcm, toFloat(frame))
      while (this.pcm.length >= CHUNK_SAMPLES) {
        const chunk = this.pcm.slice(0, CHUNK_SAMPLES)
        this.pcm = this.pcm.slice(CHUNK_SAMPLES)
        await this.processChunk(chunk)
      }
    } finally {
      this.busy = false
    }
  }

  private async processChunk(chunk: Float32Array): Promise<void> {
    const mel = await this.opts.runMel(chunk)
    const frames = mel.dims[mel.dims.length - 2]
    for (let f = 0; f < frames; f++) {
      const row = new Float32Array(N_MELS)
      for (let m = 0; m < N_MELS; m++) row[m] = mel.data[f * N_MELS + m] / 10 + 2
      this.melFrames.push(row)
    }

    // Slide the 76-frame embedding window every 8 new frames.
    while (this.melFrames.length - this.melConsumed >= EMB_WINDOW_FRAMES) {
      const win = new Float32Array(EMB_WINDOW_FRAMES * N_MELS)
      for (let f = 0; f < EMB_WINDOW_FRAMES; f++) win.set(this.melFrames[this.melConsumed + f], f * N_MELS)
      const emb = await this.opts.runEmb(win)
      this.embeddings.push(Float32Array.from(emb.data))
      this.melConsumed += EMB_STEP_FRAMES
      // Bound memory: drop mel frames no window can need again.
      if (this.melConsumed > EMB_WINDOW_FRAMES * 4) {
        this.melFrames = this.melFrames.slice(this.melConsumed)
        this.melConsumed = 0
      }
      if (this.embeddings.length > WAKE_CONTEXT) this.embeddings = this.embeddings.slice(-WAKE_CONTEXT)

      if (this.embeddings.length === WAKE_CONTEXT) {
        if (this.refractory > 0) continue
        const feat = new Float32Array(WAKE_CONTEXT * EMB_DIM)
        for (let j = 0; j < WAKE_CONTEXT; j++) feat.set(this.embeddings[j], j * EMB_DIM)
        const out = await this.opts.runWake(feat)
        const score = out.data[0]
        if (score >= this.opts.threshold) {
          this.refractory = this.opts.refractoryChunks
          this.opts.onWake(score)
        }
      }
    }
    if (this.refractory > 0) this.refractory--
  }
}

function toFloat(frame: Int16Array | Float32Array): Float32Array<ArrayBufferLike> {
  // openWakeWord's models take raw int16-range values as float32 — no normalizing.
  return frame instanceof Float32Array ? frame : Float32Array.from(frame)
}
function concat(a: Float32Array<ArrayBufferLike>, b: Float32Array<ArrayBufferLike>): Float32Array<ArrayBufferLike> {
  if (a.length === 0) return b
  const out = new Float32Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

// ── Real runners: onnxruntime-web sessions over the committed model files ─────
// Lazy in every direction: ort's WASM + the three models load only when called.
export async function createOrtRunners(): Promise<{ runMel: ModelRunner; runEmb: ModelRunner; runWake: ModelRunner }> {
  // The wasm-EP-only build — the only execution provider this pipeline uses.
  const ort = await import('onnxruntime-web/wasm')
  // ort's 13 MB wasm is served by the app itself at /ort/ (the ortWasmAssets
  // plugin in vite.config.ts emits it from node_modules at build) — the kiosk
  // never fetches from a third-party CDN and nothing heavy lands in git.
  ort.env.wasm.wasmPaths = '/ort/'

  const opt = { executionProviders: ['wasm' as const] }
  const [mel, emb, wake] = await Promise.all([
    ort.InferenceSession.create('/models/oww/melspectrogram.onnx', opt),
    ort.InferenceSession.create('/models/oww/embedding_model.onnx', opt),
    ort.InferenceSession.create('/models/oww/hey_jarvis_v0.1.onnx', opt),
  ])
  const run = (session: typeof mel, dims: (n: number) => number[]): ModelRunner => async (input) => {
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, dims(input.length)) })
    const t = Object.values(out)[0]
    return { dims: t.dims as number[], data: t.data as Float32Array }
  }
  return {
    runMel: run(mel, (n) => [1, n]),
    runEmb: run(emb, () => [1, EMB_WINDOW_FRAMES, N_MELS, 1]),
    runWake: run(wake, () => [1, WAKE_CONTEXT, EMB_DIM]),
  }
}

// ── Mic wiring — same WebVoiceProcessor (Apache-2.0, no account) Porcupine uses.
type StopFn = () => Promise<void>

export async function startOpenWakeWord(onWake: () => void): Promise<StopFn> {
  const [{ WebVoiceProcessor }, runners] = await Promise.all([
    import('@picovoice/web-voice-processor'),
    createOrtRunners(),
  ])
  const detector = new OwwDetector({ ...runners, onWake: () => onWake() })
  const engine = {
    onmessage: (e: MessageEvent) => {
      if (e.data?.command === 'process') void detector.process(e.data.inputFrame as Int16Array)
    },
  }
  await WebVoiceProcessor.subscribe(engine)
  return async () => {
    await WebVoiceProcessor.unsubscribe(engine)
  }
}
