// Spoken replies: Fully Kiosk's native TTS when available (better voices on a
// Fire tablet, and it works while the page is dimmed), else speechSynthesis.
import { fullySpeak } from '../fully'

export function speak(text: string): void {
  if (!text) return
  if (fullySpeak(text)) return
  if (typeof speechSynthesis === 'undefined') return
  try {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.05
    speechSynthesis.speak(u)
  } catch {
    // No voice output available — the HUD still shows the text.
  }
}
