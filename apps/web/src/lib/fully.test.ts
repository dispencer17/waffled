// Night-dim backlight bridge — when the kiosk runs inside Fully Kiosk, the CSS
// dim overlay should be backed by REAL backlight dimming (and restore on wake).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyNightBacklight, NIGHT_BACKLIGHT } from './fully'

type FullyWindow = Window & { fully?: { setScreenBrightness?: (v: number) => void; getScreenBrightness?: () => number } }

beforeEach(() => {
  delete (window as FullyWindow).fully
  applyNightBacklight(false) // reset module state between tests
})

describe('applyNightBacklight', () => {
  it('no-ops (returns false) outside Fully Kiosk', () => {
    expect(applyNightBacklight(true)).toBe(false)
    expect(applyNightBacklight(false)).toBe(false)
  })

  it('drops the real backlight on dim and restores the remembered level on wake', () => {
    const set = vi.fn()
    ;(window as FullyWindow).fully = { setScreenBrightness: set, getScreenBrightness: () => 200 }
    expect(applyNightBacklight(true)).toBe(true)
    expect(set).toHaveBeenLastCalledWith(NIGHT_BACKLIGHT)
    applyNightBacklight(false)
    expect(set).toHaveBeenLastCalledWith(200)
  })

  it('re-applying dim never overwrites the remembered daytime level', () => {
    const set = vi.fn()
    let current = 180
    ;(window as FullyWindow).fully = { setScreenBrightness: (v: number) => { current = v; set(v) }, getScreenBrightness: () => current }
    applyNightBacklight(true)
    applyNightBacklight(true) // second tick while already dim — must not remember 32
    applyNightBacklight(false)
    expect(set).toHaveBeenLastCalledWith(180)
  })

  it('falls back to full brightness when the daytime level was unreadable', () => {
    const set = vi.fn()
    ;(window as FullyWindow).fully = { setScreenBrightness: set }
    applyNightBacklight(true)
    applyNightBacklight(false)
    expect(set).toHaveBeenLastCalledWith(255)
  })
})
