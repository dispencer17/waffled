// Wake word (fork) — two engines behind one switch, both lazy-loaded so
// households that never enable the toggle don't pay any WASM download:
//  - openWakeWord (default): account-free, in-browser ONNX ("Hey Jarvis") —
//    used whenever no Picovoice AccessKey is configured. EXPERIMENTAL — real-mic
//    verification pending.
//  - Porcupine: used when a Picovoice AccessKey is set (more built-in keywords,
//    usage-metered free personal tier).

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
