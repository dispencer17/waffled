// Push-to-talk recorder: getUserMedia → MediaRecorder → base64 (the API takes
// base64 JSON, mirroring the media module). Recording stops on stop(), on the
// max-length safety cap, or on ~1.5s of trailing silence (cheap RMS gate via
// WebAudio — good enough to make wake-word interactions hands-free).

const MAX_MS = 12_000
const SILENCE_MS = 1_500
const SILENCE_RMS = 0.012

export interface Recording {
  audioBase64: string
  mimeType: string
}

export interface ActiveRecording {
  stop: () => void
  done: Promise<Recording | null> // null = no audio captured / mic denied
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return 'audio/webm'
}

export async function startRecording(): Promise<ActiveRecording | null> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    return null
  }

  const mimeType = pickMime()
  const rec = new MediaRecorder(stream, { mimeType })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)

  // Trailing-silence detector — only arms once some speech has been heard.
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  ctx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  let heardSpeech = false
  let silentSince = 0

  let finish!: () => void // assigned synchronously in the Promise executor below
  const done = new Promise<Recording | null>((resolve) => {
    let finished = false
    finish = () => {
      if (finished) return
      finished = true
      clearInterval(meter)
      clearTimeout(cap)
      if (rec.state !== 'inactive') rec.stop()
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close().catch(() => {})
        const blob = new Blob(chunks, { type: mimeType.split(';')[0] })
        if (!blob.size) return resolve(null)
        const reader = new FileReader()
        reader.onloadend = () => {
          const dataUrl = String(reader.result ?? '')
          const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
          resolve(b64 ? { audioBase64: b64, mimeType: mimeType.split(';')[0] } : null)
        }
        reader.readAsDataURL(blob)
      }
      // If stop() already fired before onstop was assigned, trigger manually.
      if (rec.state === 'inactive') rec.onstop?.(new Event('stop'))
    }
    const cap = setTimeout(() => finish(), MAX_MS)
    const meter = setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      const now = Date.now()
      if (rms > SILENCE_RMS) {
        heardSpeech = true
        silentSince = 0
      } else if (heardSpeech) {
        if (!silentSince) silentSince = now
        else if (now - silentSince > SILENCE_MS) finish()
      }
    }, 100)
  })

  rec.start()
  return { stop: () => finish(), done }
}
