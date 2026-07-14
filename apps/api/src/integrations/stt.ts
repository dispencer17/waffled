// Speech-to-text (fork) — one client for any OpenAI-audio-compatible server.
// Provider chain: an explicit WHISPER_BASE_URL (self-hosted faster-whisper via
// the compose `voice` profile) wins; else OpenAI whisper-1 when OPENAI_API_KEY
// is set; else transcription is unavailable and the voice routes 501.
import { config } from '../platform/config'

export type SttProvider = 'local' | 'openai'

export function sttProvider(): SttProvider | null {
  if (config.voice.whisperBaseUrl) return 'local'
  if (config.ai.openai.apiKey) return 'openai'
  return null
}

function endpoint(): { url: string; headers: Record<string, string>; model: string } {
  if (config.voice.whisperBaseUrl) {
    const base = config.voice.whisperBaseUrl.replace(/\/+$/, '')
    return { url: `${base}/audio/transcriptions`, headers: {}, model: config.voice.whisperModel }
  }
  return {
    url: 'https://api.openai.com/v1/audio/transcriptions',
    headers: { authorization: `Bearer ${config.ai.openai.apiKey}` },
    model: 'whisper-1',
  }
}

/** Transcribe an audio clip. Throws on transport errors; '' for silence. */
export async function transcribe(audio: Buffer, mimeType: string): Promise<string> {
  const { url, headers, model } = endpoint()
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('wav') ? 'wav' : 'webm'
  const form = new FormData()
  form.append('model', model)
  form.append('response_format', 'json')
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `clip.${ext}`)
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`stt -> ${res.status} ${await res.text().catch(() => '')}`)
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}
