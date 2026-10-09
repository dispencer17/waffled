// PIN entry for a PIN-protected profile. A big touch keypad (kiosk is a
// touchscreen); claims the profile on ✓. Distinguishes a wrong PIN (401) from a
// lockout (429, with a countdown hint) via KioskClaimError.
import { useState } from 'react'
import { kioskApi, type KioskProfile } from '../lib/api'
import { Keypad, codeErrorMessage } from './Keypad'

export function PinPad({ profile, onCancel }: { profile: KioskProfile; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)

  async function submit(pin: string): Promise<string | null> {
    setBusy(true)
    try {
      await kioskApi.claim(profile.id, pin) // success → setSession → AuthGate flips
      return null
    } catch (e) {
      setBusy(false)
      return codeErrorMessage(e, 'PIN')
    }
  }

  return (
    <div className="kp-screen">
      <Keypad
        header={
          <>
            <span className="kp-av kp-av-lg" style={{ background: profile.colorHex ? `${profile.colorHex}22` : 'var(--panel)' }}>
              {profile.avatarEmoji ?? '🙂'}
            </span>
            <div className="kp-title wf-serif">{profile.name}’s PIN</div>
          </>
        }
        hint="Enter your PIN"
        cap="4–8 digits"
        onSubmit={submit}
      />
      <button className="kp-cancel" onClick={onCancel} disabled={busy}>
        ← Back to profiles
      </button>
    </div>
  )
}
