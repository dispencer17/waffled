import { useEffect, useRef, useState } from 'react'
import { voiceApi, addTimer, prefillCapture, kioskApi, VOICE_START, type VoiceAction } from '../../lib/api'
import { startRecording, type ActiveRecording } from '../../lib/voice/recorder'
import { speak } from '../../lib/voice/tts'
import { startWakeWord, stopWakeWord } from '../../lib/voice/wakeword'

// Voice HUD (fork) — the run-loop for a spoken command: record (push-to-talk
// via the capture-bar mic or the wake word) → transcribe → execute → speak the
// reply. Timers are dispatched to <Timers/>; calendar/chore/meal mutations are
// bounced into the capture bar (prefilled) so they keep the visual confirm flow.

type HudState =
  | { phase: 'idle' }
  | { phase: 'listening' }
  | { phase: 'thinking'; transcript?: string }
  | { phase: 'reply'; text: string }

export function VoiceHud() {
  const [state, setState] = useState<HudState>({ phase: 'idle' })
  const active = useRef<ActiveRecording | null>(null)
  const busy = useRef(false)

  async function runOnce(): Promise<void> {
    if (busy.current) {
      active.current?.stop() // second tap = stop early
      return
    }
    busy.current = true
    try {
      const rec = await startRecording()
      if (!rec) {
        setState({ phase: 'reply', text: 'Microphone unavailable — check browser permissions.' })
        return
      }
      active.current = rec
      setState({ phase: 'listening' })
      const clip = await rec.done
      active.current = null
      if (!clip) {
        setState({ phase: 'idle' })
        return
      }
      setState({ phase: 'thinking' })
      const { transcript } = await voiceApi.transcribe(clip.audioBase64, clip.mimeType)
      if (!transcript) {
        setState({ phase: 'reply', text: "I didn't catch that." })
        speak("I didn't catch that.")
        return
      }
      setState({ phase: 'thinking', transcript })
      const action: VoiceAction = await voiceApi.command(transcript)
      if (action.kind === 'timer') addTimer(action.seconds, action.label)
      if (action.kind === 'capture') {
        prefillCapture(action.transcript)
        setState({ phase: 'idle' })
        return
      }
      const say = action.say ?? ''
      setState({ phase: 'reply', text: say })
      speak(say)
    } catch {
      setState({ phase: 'reply', text: 'Something went wrong — try again.' })
    } finally {
      busy.current = false
    }
  }

  // Push-to-talk trigger (capture-bar mic, or anything else that dispatches it).
  useEffect(() => {
    const start = () => void runOnce()
    window.addEventListener(VOICE_START, start)
    return () => window.removeEventListener(VOICE_START, start)
  }, [])

  // Wake word — armed from kiosk display settings (admin-set, device-served).
  useEffect(() => {
    let alive = true
    kioskApi
      .displayConfig()
      .then((cfg) => {
        if (!alive || !cfg.voice?.wakeWord) return
        // No Picovoice key → the account-free openWakeWord engine ("Hey Jarvis").
        void startWakeWord(cfg.voice.picovoiceKey ?? null, cfg.voice.keyword || 'Computer', () => {
          speak('Yes?')
          void runOnce()
        })
      })
      .catch(() => {})
    return () => {
      alive = false
      void stopWakeWord()
    }
  }, [])

  // Auto-clear replies after a beat.
  useEffect(() => {
    if (state.phase !== 'reply') return
    const id = setTimeout(() => setState({ phase: 'idle' }), 6000)
    return () => clearTimeout(id)
  }, [state])

  if (state.phase === 'idle') return null

  return (
    <div
      style={{
        position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 960,
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderRadius: 999,
        background: 'var(--card)', boxShadow: 'var(--sh-3)', maxWidth: '80vw',
      }}
      role="status"
      onClick={() => state.phase === 'listening' && active.current?.stop()}
    >
      <span style={{ fontSize: 22 }} aria-hidden="true">
        {state.phase === 'listening' ? '🎙️' : state.phase === 'thinking' ? '💭' : '💬'}
      </span>
      <span style={{ fontWeight: 700 }}>
        {state.phase === 'listening' && 'Listening… (tap to stop)'}
        {state.phase === 'thinking' && (state.transcript ? `“${state.transcript}”` : 'Thinking…')}
        {state.phase === 'reply' && state.text}
      </span>
    </div>
  )
}
