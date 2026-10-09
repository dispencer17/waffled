// Household lock screen (fork). "Look, don't touch": while locked, a transparent
// shield sits over the whole app (and the profile picker) so the family display
// stays readable, but any tap opens the code keypad and key presses are swallowed.
// It starts locked on mount (a reload never unlocks), re-locks after idleMinutes
// without input or when the screensaver comes up, and a 🔒 button locks at once.
// Mounted by KioskDisplay only on a paired kiosk with the lock on and a code set.
import { useEffect, useRef, useState } from 'react'
import { kioskApi } from '../lib/api'
import { Keypad, codeErrorMessage } from './Keypad'

const CODE_LENGTH = 4

export function KioskLock({ idleMinutes, screensaverUp }: { idleMinutes: number; screensaverUp: boolean }) {
  const [locked, setLocked] = useState(true)
  const [padOpen, setPadOpen] = useState(false)
  const padRef = useRef<HTMLDivElement>(null)

  const lock = () => { setLocked(true); setPadOpen(false) }

  // The screensaver coming up counts as walking away.
  useEffect(() => { if (screensaverUp) lock() }, [screensaverUp])

  // Idle re-lock while unlocked.
  useEffect(() => {
    if (locked) return
    let t: ReturnType<typeof setTimeout> | undefined
    const arm = () => { clearTimeout(t); t = setTimeout(lock, idleMinutes * 60_000) }
    const evs = ['pointerdown', 'keydown', 'pointermove', 'wheel', 'touchstart']
    evs.forEach((e) => window.addEventListener(e, arm, { passive: true }))
    arm()
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, arm)) }
  }, [locked, idleMinutes])

  // While locked, keys never reach the app (a focused field, shortcuts). Keys aimed
  // at the keypad itself still work.
  useEffect(() => {
    if (!locked) return
    const swallow = (e: KeyboardEvent) => {
      if (padRef.current?.contains(e.target as Node)) return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', swallow, true)
    return () => window.removeEventListener('keydown', swallow, true)
  }, [locked])

  async function submit(code: string): Promise<string | null> {
    try {
      await kioskApi.unlock(code)
      setLocked(false)
      setPadOpen(false)
      return null
    } catch (e) {
      return codeErrorMessage(e, 'code')
    }
  }

  if (!locked) {
    return (
      <button type="button" className="kl-lock-btn" onClick={lock} aria-label="Lock the tablet" title="Lock the tablet">
        🔒
      </button>
    )
  }

  return (
    <>
      <div className="kl-shield" role="button" aria-label="The tablet is locked — tap to unlock" onClick={() => setPadOpen(true)} />
      {padOpen && (
        <div className="modal-overlay kl-overlay" ref={padRef}>
          <div className="modal-card kl-card" role="dialog" aria-label="Unlock the tablet">
            <Keypad
              header={
                <>
                  <span className="kp-av kp-av-lg">🔒</span>
                  <div className="kp-title wf-serif">Enter the lock code</div>
                </>
              }
              hint="4-digit code"
              cap="Ask a grown-up"
              minLength={CODE_LENGTH}
              maxLength={CODE_LENGTH}
              autoSubmit
              onSubmit={submit}
            />
            <button type="button" className="btn btn-ghost kl-cancel" onClick={() => setPadOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
