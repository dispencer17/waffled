import { useEffect, useRef, useState } from 'react'
import { TIMER_ADD } from '../../lib/api'
import { speak } from '../../lib/voice/tts'

// Kitchen timers (fork) — client-local floating chips, fed by voice ("set a
// timer for 10 minutes") or anything dispatching the TIMER_ADD event. Alarm =
// WebAudio beeps + a spoken announcement; a chip stays until dismissed.

interface Timer {
  id: number
  label: string
  endsAt: number
  ringing: boolean
}

let nextId = 1

function fmt(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

function beep(): void {
  try {
    const ctx = new AudioContext()
    const t0 = ctx.currentTime
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.001, t0 + i * 0.4)
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.4 + 0.05)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.4 + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + i * 0.4)
      osc.stop(t0 + i * 0.4 + 0.35)
    }
    setTimeout(() => void ctx.close().catch(() => {}), 2500)
  } catch {
    // No audio — the chip still turns red.
  }
}

export function Timers() {
  const [timers, setTimers] = useState<Timer[]>([])
  const [, setTick] = useState(0)
  const rangRef = useRef(new Set<number>())

  useEffect(() => {
    const onAdd = (e: Event) => {
      const d = (e as CustomEvent<{ seconds: number; label: string }>).detail
      if (!d?.seconds) return
      setTimers((ts) => [...ts, { id: nextId++, label: d.label || 'Timer', endsAt: Date.now() + d.seconds * 1000, ringing: false }])
    }
    window.addEventListener(TIMER_ADD, onAdd)
    return () => window.removeEventListener(TIMER_ADD, onAdd)
  }, [])

  // One shared ticker: re-render each second and fire alarms as timers lapse.
  useEffect(() => {
    if (!timers.length) return
    const id = setInterval(() => {
      setTick((t) => t + 1)
      const now = Date.now()
      setTimers((ts) =>
        ts.map((t) => {
          if (!t.ringing && t.endsAt <= now && !rangRef.current.has(t.id)) {
            rangRef.current.add(t.id)
            beep()
            speak(`${t.label} is done.`)
            return { ...t, ringing: true }
          }
          return t
        })
      )
    }, 1000)
    return () => clearInterval(id)
  }, [timers.length])

  if (!timers.length) return null

  return (
    <div style={{ position: 'fixed', bottom: 18, right: 18, zIndex: 950, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {timers.map((t) => {
        const left = t.endsAt - Date.now()
        return (
          <div
            key={t.id}
            className="card"
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              borderRadius: 999, boxShadow: 'var(--sh-2)',
              background: t.ringing ? 'var(--danger)' : 'var(--card)',
              color: t.ringing ? 'var(--on-accent, #fff)' : 'var(--ink)',
            }}
          >
            <span aria-hidden="true">{t.ringing ? '🔔' : '⏲️'}</span>
            <span style={{ fontWeight: 800 }}>{t.label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{t.ringing ? 'Done!' : fmt(left)}</span>
            <button
              type="button"
              aria-label={`Dismiss ${t.label}`}
              onClick={() => setTimers((ts) => ts.filter((x) => x.id !== t.id))}
              style={{ background: 'none', border: 'none', color: 'inherit', fontSize: 18, cursor: 'pointer', padding: '0 2px' }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
