// Wake word (fork) — Porcupine Web WASM listening for a built-in keyword
// (default "Computer"; pick another in Settings → Display & Kiosk → Voice).
// The Picovoice AccessKey comes from kiosk display settings (per-install,
// usage-metered on the free personal tier). Loaded lazily so households that
// never enable it don't pay the WASM download.

type StopFn = () => Promise<void>

let running: StopFn | null = null

export async function startWakeWord(
  accessKey: string,
  keyword: string,
  onWake: () => void
): Promise<boolean> {
  if (running) return true
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
