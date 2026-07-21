// Voice assistant (fork) — client slice for /api/voice.
import { apiGet, apiSend } from './client'

export interface VoiceStatus {
  stt: 'local' | 'openai' | null
}

export type VoiceAction =
  | { kind: 'timer'; seconds: number; label: string; say: string }
  | { kind: 'grocery'; added: string[]; say: string }
  | { kind: 'ha'; entityId: string; say: string }
  | { kind: 'query'; say: string }
  | { kind: 'capture'; transcript: string; say: string | null }
  | { kind: 'none'; say: string }

export const voiceApi = {
  status: () => apiGet<VoiceStatus>('/api/voice/status'),
  transcribe: (audioBase64: string, mimeType: string) =>
    apiSend<{ transcript: string }>('POST', '/api/voice/transcribe', { audio: audioBase64, mimeType }),
  command: (transcript: string) => apiSend<VoiceAction>('POST', '/api/voice/command', { transcript }),
}

// Cross-component signals (CaptureBar mic / wake word → HUD; HUD → timers/capture).
export const VOICE_START = 'waffled:voice-start'
export const TIMER_ADD = 'waffled:timer-add'
export const CAPTURE_PREFILL = 'waffled:capture-prefill'
// Fired when a Settings wake-word test finishes so VoiceHud re-arms its session.
export const WAKEWORD_REARM = 'waffled:wakeword-rearm'

export function requestVoiceCapture(): void {
  window.dispatchEvent(new CustomEvent(VOICE_START))
}

export function addTimer(seconds: number, label: string): void {
  window.dispatchEvent(new CustomEvent(TIMER_ADD, { detail: { seconds, label } }))
}

export function prefillCapture(text: string): void {
  window.dispatchEvent(new CustomEvent(CAPTURE_PREFILL, { detail: { text } }))
}
