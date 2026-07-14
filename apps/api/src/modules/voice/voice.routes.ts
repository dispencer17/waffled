// Voice assistant (fork) — HTTP routes (/api/voice). Audio arrives as base64
// inside a JSON body (same rationale as the media module: lambda-api coerces
// bodies to strings, so raw multipart is unsafe). Any household member.
import createAPI, { type Request, type Response } from 'lambda-api'
import { tenantRoute } from '../../platform/route-guards'
import { transcribe, sttProvider } from '../../integrations/stt'
import { runCommand } from './voice.service'
import type { VoiceStatusDto } from './voice.types'

type Api = ReturnType<typeof createAPI>

const MAX_AUDIO_BYTES = 4 * 1024 * 1024 // ~4 MB ≈ well over a minute of opus
const AUDIO_TYPES = /^audio\/(webm|ogg|wav|mp4|mpeg|x-m4a)/

export function registerVoiceRoutes(api: Api): void {
  // Which STT backend is live (drives showing the mic button).
  api.get('/api/voice/status', tenantRoute(async (): Promise<VoiceStatusDto> => ({ stt: sttProvider() })))

  // base64 audio clip → transcript.
  api.post('/api/voice/transcribe', tenantRoute(async (_tenant, req: Request, res: Response) => {
    if (!sttProvider()) {
      return res.status(501).json({
        error: 'NotConfigured',
        message: 'No speech-to-text backend (set WHISPER_BASE_URL or OPENAI_API_KEY)',
      })
    }
    const body = (req.body ?? {}) as { audio?: unknown; mimeType?: unknown }
    const mimeType = typeof body.mimeType === 'string' && AUDIO_TYPES.test(body.mimeType) ? body.mimeType : 'audio/webm'
    if (typeof body.audio !== 'string' || !body.audio) {
      return res.status(400).json({ error: 'BadRequest', message: 'audio (base64) is required' })
    }
    const buf = Buffer.from(body.audio, 'base64')
    if (!buf.length) return res.status(400).json({ error: 'BadRequest', message: 'audio is not valid base64' })
    if (buf.length > MAX_AUDIO_BYTES) return res.status(413).json({ error: 'TooLarge', message: 'audio clip too large' })
    try {
      return { transcript: await transcribe(buf, mimeType) }
    } catch (err) {
      console.error('voice transcribe failed', err)
      return res.status(502).json({ error: 'BadGateway', message: 'transcription failed' })
    }
  }))

  // transcript → executed action + short spoken reply.
  api.post('/api/voice/command', tenantRoute(async (tenant, req: Request, res: Response) => {
    const body = (req.body ?? {}) as { transcript?: unknown }
    if (typeof body.transcript !== 'string' || !body.transcript.trim()) {
      return res.status(400).json({ error: 'BadRequest', message: 'transcript is required' })
    }
    return runCommand(tenant, body.transcript.slice(0, 500))
  }))
}
