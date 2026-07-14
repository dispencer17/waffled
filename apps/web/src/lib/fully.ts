// Fully Kiosk Browser JS API — feature-detected wrapper. When the kiosk runs
// inside Fully (Android/Fire tablet, PLUS license with the JavaScript
// interface enabled) a `window.fully` object exposes device controls a web
// page normally can't touch: real backlight brightness and native TTS.
// Everything here no-ops gracefully in a normal browser.

interface FullyApi {
  setScreenBrightness?: (value: number) => void
  getScreenBrightness?: () => number
  textToSpeech?: (text: string) => void
  stopTextToSpeech?: () => void
}

function fully(): FullyApi | null {
  const f = (window as Window & { fully?: FullyApi }).fully
  return f && typeof f === 'object' ? f : null
}

export function isFully(): boolean {
  return fully() !== null
}

/** Real backlight brightness, 0–255. Returns false when unavailable. */
export function setScreenBrightness(value: number): boolean {
  const f = fully()
  if (!f?.setScreenBrightness) return false
  f.setScreenBrightness(Math.max(0, Math.min(255, Math.round(value))))
  return true
}

export function getScreenBrightness(): number | null {
  const f = fully()
  try {
    return f?.getScreenBrightness ? f.getScreenBrightness() : null
  } catch {
    return null
  }
}

/** Native TTS when in Fully. Returns false so callers can fall back. */
export function fullySpeak(text: string): boolean {
  const f = fully()
  if (!f?.textToSpeech) return false
  f.textToSpeech(text)
  return true
}
