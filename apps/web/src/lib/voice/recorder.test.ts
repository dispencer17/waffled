// The 2026-07-21 "listens then ignores everything" bug: MediaRecorder.stop()
// flips state to 'inactive' SYNCHRONOUSLY, so finish()'s already-stopped
// fallback fired on every recording and built the blob before the async
// dataavailable task delivered the audio — every clip resolved null. These
// stubs mimic the spec's ordering exactly (sync state flip; async events).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startRecording } from './recorder'

class FakeMediaRecorder {
  static isTypeSupported = () => true
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: ((e: Event) => void) | null = null
  constructor(public stream: unknown, public opts: { mimeType: string }) {}
  start() {
    this.state = 'recording'
  }
  stop() {
    // Spec: state transitions synchronously; dataavailable + stop fire as
    // later tasks, carrying ALL the recorded bytes (no timeslice given).
    this.state = 'inactive'
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)]) })
      this.onstop?.(new Event('stop'))
    }, 0)
  }
}

const fakeTrack = () => ({ stop: vi.fn(), readyState: 'live' })
const fakeStream = () => {
  const t = fakeTrack()
  return { getTracks: () => [t], getAudioTracks: () => [t] }
}

class FakeAudioContext {
  state = 'running'
  createAnalyser() {
    return { fftSize: 512, getFloatTimeDomainData: (buf: Float32Array) => buf.fill(0) }
  }
  createMediaStreamSource() {
    return { connect: () => {} }
  }
  close() {
    return Promise.resolve()
  }
}

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream()) },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startRecording', () => {
  it('resolves the recorded clip after stop() — the bytes arrive AFTER the state flip', async () => {
    const rec = await startRecording()
    expect(rec).not.toBeNull()
    await new Promise((r) => setTimeout(r, 20)) // "speak" for a beat
    rec!.stop()
    const clip = await rec!.done
    expect(clip).not.toBeNull()
    expect(clip!.audioBase64.length).toBeGreaterThan(0)
    expect(clip!.mimeType).toBe('audio/webm')
  })

  it('a second stop() is a no-op (double-finish guard)', async () => {
    const rec = await startRecording()
    rec!.stop()
    rec!.stop()
    const clip = await rec!.done
    expect(clip).not.toBeNull()
  })

  it('returns null when the microphone is denied', async () => {
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('denied'))
    expect(await startRecording()).toBeNull()
  })
})
