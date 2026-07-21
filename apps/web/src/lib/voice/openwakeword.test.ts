// OwwDetector — the openWakeWord streaming pipeline with the three model runners
// injected, so the buffering/threshold/refractory logic is testable without WASM.
import { describe, it, expect, vi } from 'vitest'
import { OwwDetector, MEL_FRAMES_PER_CHUNK, EMB_WINDOW_FRAMES, EMB_STEP_FRAMES, WAKE_CONTEXT } from './openwakeword'

// A mel runner that yields 8 frames of 32 mels per 1280-sample chunk, values 0.
const melRunner = vi.fn(async () => ({
  dims: [1, 1, MEL_FRAMES_PER_CHUNK, 32],
  data: new Float32Array(MEL_FRAMES_PER_CHUNK * 32),
}))
const embRunner = vi.fn(async () => ({ dims: [1, 1, 1, 96], data: new Float32Array(96) }))
const wakeAt = (score: number) => vi.fn(async () => ({ dims: [1, 1], data: new Float32Array([score]) }))

const CHUNK = new Float32Array(1280)

async function feedChunks(det: OwwDetector, n: number) {
  for (let i = 0; i < n; i++) await det.process(CHUNK)
}

describe('OwwDetector', () => {
  it('does not run the embedding model until a full 76-frame window exists, then steps every 8 frames', async () => {
    const emb = vi.fn(async (_win: Float32Array<ArrayBufferLike>) => ({ dims: [1, 1, 1, 96], data: new Float32Array(96) }))
    const det = new OwwDetector({ runMel: melRunner, runEmb: emb, runWake: wakeAt(0), onWake: () => {} })
    // 9 chunks × 8 frames = 72 frames < 76 → no embedding yet
    await feedChunks(det, 9)
    expect(emb).not.toHaveBeenCalled()
    // 10th chunk → 80 frames ≥ 76 → exactly one embedding (window [0,76))
    await feedChunks(det, 1)
    expect(emb).toHaveBeenCalledTimes(1)
    // each further chunk adds 8 frames = one more step
    await feedChunks(det, 3)
    expect(emb).toHaveBeenCalledTimes(4)
    // the embedding input is a 76×32 window
    const arg = emb.mock.calls[0][0]
    expect(arg.length).toBe(EMB_WINDOW_FRAMES * 32)
  })

  it('runs the wake head only once 16 embeddings exist, and fires onWake at threshold', async () => {
    const onWake = vi.fn()
    const det = new OwwDetector({ runMel: melRunner, runEmb: embRunner, runWake: wakeAt(0.9), onWake, threshold: 0.5 })
    // 16 embeddings need 76 + 15*8 = 196 frames = 24.5 chunks → 25 chunks
    await feedChunks(det, 24)
    expect(onWake).not.toHaveBeenCalled()
    await feedChunks(det, 1)
    expect(onWake).toHaveBeenCalledTimes(1)
  })

  it('never fires below threshold', async () => {
    const onWake = vi.fn()
    const det = new OwwDetector({ runMel: melRunner, runEmb: embRunner, runWake: wakeAt(0.2), onWake, threshold: 0.5 })
    await feedChunks(det, 40)
    expect(onWake).not.toHaveBeenCalled()
  })

  it('applies a refractory period after firing (no immediate re-trigger)', async () => {
    const onWake = vi.fn()
    const det = new OwwDetector({
      runMel: melRunner, runEmb: embRunner, runWake: wakeAt(0.9), onWake,
      threshold: 0.5, refractoryChunks: 10,
    })
    await feedChunks(det, 25) // first fire
    expect(onWake).toHaveBeenCalledTimes(1)
    await feedChunks(det, 9) // still inside refractory
    expect(onWake).toHaveBeenCalledTimes(1)
    await feedChunks(det, 2) // past refractory → can fire again
    expect(onWake).toHaveBeenCalledTimes(2)
  })

  it('accepts Int16Array input (raw mic frames) and buffers sub-chunk frames', async () => {
    const mel = vi.fn(async () => ({ dims: [1, 1, MEL_FRAMES_PER_CHUNK, 32], data: new Float32Array(MEL_FRAMES_PER_CHUNK * 32) }))
    const det = new OwwDetector({ runMel: mel, runEmb: embRunner, runWake: wakeAt(0), onWake: () => {} })
    // 512-sample frames (WebVoiceProcessor size): 2 frames = 1024 < 1280 → no mel yet
    await det.process(new Int16Array(512))
    await det.process(new Int16Array(512))
    expect(mel).not.toHaveBeenCalled()
    await det.process(new Int16Array(512)) // 1536 ≥ 1280 → one mel chunk
    expect(mel).toHaveBeenCalledTimes(1)
  })

  it('exports the pipeline constants the runners are shaped around', () => {
    expect(MEL_FRAMES_PER_CHUNK).toBe(8)
    expect(EMB_WINDOW_FRAMES).toBe(76)
    expect(EMB_STEP_FRAMES).toBe(8)
    expect(WAKE_CONTEXT).toBe(16)
  })
})
