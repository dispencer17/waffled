// Wake word (fork) — two engines behind one switch, both lazy-loaded so
// households that never enable the toggle don't pay any WASM download:
//  - openWakeWord (default): account-free, in-browser ONNX ("Hey Jarvis") —
//    used whenever no Picovoice AccessKey is configured. EXPERIMENTAL — real-mic
//    verification pending.
//  - Porcupine: used when a Picovoice AccessKey is set (more built-in keywords,
//    usage-metered free personal tier).
import { WAKEWORD_REARM } from '../api/voice'

type StopFn = () => Promise<void>

let running: StopFn | null = null

export async function startWakeWord(
  accessKey: string | null,
  keyword: string,
  onWake: () => void
): Promise<boolean> {
  if (running) return true
  if (!accessKey) {
    try {
      const { startOpenWakeWord } = await import('./openwakeword')
      running = await startOpenWakeWord(onWake)
      return true
    } catch (err) {
      console.error('openWakeWord failed to start', err)
      return false
    }
  }
  try {
    const [{ PorcupineWorker, BuiltInKeyword }, { WebVoiceProcessor }] = await Promise.all([
      import('@picovoice/porcupine-web'),
      import('@picovoice/web-voice-processor'),
    ])
    const builtin = (Object.values(BuiltInKeyword) as string[]).includes(keyword)
      ? (keyword as (typeof BuiltInKeyword)[keyof typeof BuiltInKeyword])
      : BuiltInKeyword.Computer
    const worker = await PorcupineWorker.create(
      accessKey,
      // Built-in keyword; a custom "Hey Waffled" (.ppn trained on the Picovoice
      // console, dropped into public/models/) can replace this via publicPath.
      [{ builtin, sensitivity: 0.6 }],
      () => onWake(),
      // The Porcupine model file is served by the app itself (public/models/),
      // keeping the kiosk free of third-party CDN fetches.
      { publicPath: '/models/porcupine_params.pv' }
    )
    await WebVoiceProcessor.subscribe(worker)
    running = async () => {
      await WebVoiceProcessor.unsubscribe(worker)
      worker.release()
      worker.terminate()
    }
    return true
  } catch (err) {
    console.error('wake word failed to start', err)
    return false
  }
}

export async function stopWakeWord(): Promise<void> {
  const stop = running
  running = null
  if (stop) await stop().catch(() => {})
}

export function wakeWordRunning(): boolean {
  return running !== null
}

// The Porcupine built-in keywords a household can choose from.
export const BUILTIN_KEYWORDS = [
  'Computer', 'Jarvis', 'Bumblebee', 'Porcupine', 'Blueberry', 'Grasshopper', 'Terminator',
]

// ── Test session (Settings → AI & Capture → "Test wake word") ─────────────────

/** RMS of an int16 mic frame, normalized 0..1 — drives the test's level meter. */
export function frameRms(frame: Int16Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.min(1, Math.sqrt(sum / frame.length) / 32767)
}

export interface TestWakeWordOpts {
  accessKey: string | null
  keyword: string
  seconds?: number
  onLevel?: (rms: number) => void
}

// Run a short, self-contained detection session so an admin can verify the mic
// and the engine without standing at the kiosk guessing. Stops any live session
// first and fires WAKEWORD_REARM afterwards so VoiceHud re-arms the normal one.
// Resolves 'detected' | 'timeout'; throws when the mic/engine can't start.
export async function testWakeWord({ accessKey, keyword, seconds = 12, onLevel }: TestWakeWordOpts): Promise<'detected' | 'timeout'> {
  await stopWakeWord()
  const { WebVoiceProcessor } = await import('@picovoice/web-voice-processor')
  // Level meter engine — proves audio is flowing even when detection fails.
  const levelEngine = {
    onmessage: (e: MessageEvent) => {
      if (e.data?.command === 'process') onLevel?.(frameRms(e.data.inputFrame as Int16Array))
    },
  }
  let levelSubscribed = false
  try {
    // Subscribing acquires the microphone — permission errors surface here.
    await WebVoiceProcessor.subscribe(levelEngine)
    levelSubscribed = true
    return await new Promise<'detected' | 'timeout'>((resolve, reject) => {
      const timer = setTimeout(() => resolve('timeout'), seconds * 1000)
      startWakeWord(accessKey, keyword, () => {
        clearTimeout(timer)
        resolve('detected')
      }).then((ok) => {
        if (!ok) {
          clearTimeout(timer)
          reject(new Error('The wake word engine could not start — check microphone permission (details in the browser console).'))
        }
      })
    })
  } finally {
    if (levelSubscribed) await WebVoiceProcessor.unsubscribe(levelEngine).catch(() => {})
    await stopWakeWord()
    window.dispatchEvent(new Event(WAKEWORD_REARM))
  }
}
