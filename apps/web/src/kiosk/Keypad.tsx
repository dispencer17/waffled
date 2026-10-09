// The big touch keypad shared by the profile PIN pad and the kiosk lock screen.
// Callers own the header (avatar / title) and what a submitted code means;
// onSubmit resolves to an error message to show, or null on success.
import { useState, type ReactNode } from 'react'
import { KioskClaimError } from '../lib/api'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok']

// Map a KioskClaimError (401 triesLeft / 429 retryAfter) to keypad copy.
export function codeErrorMessage(e: unknown, noun = 'PIN'): string {
  const err = e as KioskClaimError
  if (err?.status === 429) {
    const s = err.retryAfter ?? 30
    return s >= 60 ? `Too many tries. Try again in ${Math.ceil(s / 60)} min.` : `Too many tries. Try again in ${s}s.`
  }
  const t = err?.triesLeft
  if (t && t > 0) return `Incorrect ${noun} — ${t} ${t === 1 ? 'try' : 'tries'} left`
  return `Incorrect ${noun}.`
}

export function Keypad({
  header,
  hint,
  cap,
  minLength = 4,
  maxLength = 8,
  autoSubmit = false,
  onSubmit,
}: {
  header: ReactNode
  hint: string
  cap: string
  minLength?: number
  maxLength?: number
  // Submit as soon as maxLength digits are in (fixed-length codes).
  autoSubmit?: boolean
  onSubmit: (code: string) => Promise<string | null>
}) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(value: string) {
    if (value.length < minLength || busy) return
    setBusy(true)
    setError(null)
    const msg = await onSubmit(value)
    if (msg === null) return // success — the caller unmounts us
    setError(msg)
    setCode('')
    setBusy(false)
  }

  function press(k: string) {
    if (busy) return
    if (k === 'del') return setCode((p) => p.slice(0, -1))
    if (k === 'ok') return void submit(code)
    if (code.length >= maxLength) return
    const next = code + k
    setCode(next)
    if (autoSubmit && next.length === maxLength) void submit(next)
  }

  return (
    <>
      <div className="kp-head">
        {header}
        <div className="kp-dots" aria-label={`${code.length} digits entered`}>
          {Array.from({ length: code.length }).map((_, i) => (
            <span key={i} className="kp-dot on" />
          ))}
          {code.length === 0 && <span className="kp-dots-hint">{hint}</span>}
        </div>
        <div className="kp-cap">{cap}</div>
        {error && <div className="kp-error">{error}</div>}
      </div>
      <div className="kp-pad">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={`kp-key ${k === 'ok' ? 'kp-key-ok' : ''} ${k === 'del' ? 'kp-key-del' : ''}`}
            onClick={() => press(k)}
            disabled={busy || (k === 'ok' && code.length < minLength)}
            aria-label={k === 'del' ? 'Delete' : k === 'ok' ? 'Submit' : k}
          >
            {k === 'del' ? '⌫' : k === 'ok' ? '✓' : k}
          </button>
        ))}
      </div>
    </>
  )
}
