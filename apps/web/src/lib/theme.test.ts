import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  readPref,
  setPref,
  resolveTheme,
  applyTheme,
  initTheme,
  setSunTimes,
  sunPrefersDark,
  readPalette,
  setPalette,
  applyPalette,
  PALETTES,
  THEME_KEY,
  SUN_KEY,
  PALETTE_KEY,
  type ThemePref,
  type PaletteId,
} from './theme'

// A controllable fake of window.matchMedia('(prefers-color-scheme: dark)').
function installMatchMedia(dark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mql = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    // legacy Safari
    addListener: (cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeListener: (cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatchEvent: () => true,
  }
  window.matchMedia = vi.fn().mockImplementation(() => mql) as unknown as typeof window.matchMedia
  return {
    // Flip the OS preference and notify subscribers, like the real MQL would.
    set(next: boolean) {
      mql.matches = next
      listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent))
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-palette')
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('theme store', () => {
  it('defaults to "system" when nothing is stored', () => {
    expect(readPref()).toBe('system')
  })

  it('persists a chosen preference to localStorage', () => {
    installMatchMedia(false)
    setPref('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(readPref()).toBe('dark')
  })

  it('ignores a garbage stored value and falls back to "system"', () => {
    localStorage.setItem(THEME_KEY, 'chartreuse')
    expect(readPref()).toBe('system')
  })

  it('resolves an explicit preference regardless of the OS setting', () => {
    installMatchMedia(true) // OS says dark…
    expect(resolveTheme('light')).toBe('light') // …but explicit light wins
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('resolves "system" from the OS media query', () => {
    const mm = installMatchMedia(false)
    expect(resolveTheme('system')).toBe('light')
    mm.set(true)
    expect(resolveTheme('system')).toBe('dark')
  })

  it('applyTheme sets data-theme on the document root', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('setPref applies the resolved theme to the DOM immediately', () => {
    installMatchMedia(false)
    setPref('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    setPref('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('setPref("system") reflects the current OS preference', () => {
    installMatchMedia(true)
    setPref('system')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('initTheme applies the stored preference on boot', () => {
    installMatchMedia(false)
    localStorage.setItem(THEME_KEY, 'dark')
    initTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('follows live OS changes only while preference is "system"', () => {
    const mm = installMatchMedia(false)
    localStorage.setItem(THEME_KEY, 'system')
    initTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    mm.set(true) // OS flips to dark
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    // Pin to light — OS changes must no longer move the theme.
    setPref('light')
    mm.set(false)
    mm.set(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('emits a waffled:theme-changed event on setPref', () => {
    installMatchMedia(false)
    const spy = vi.fn()
    window.addEventListener('waffled:theme-changed', spy)
    setPref('dark')
    expect(spy).toHaveBeenCalledOnce()
    window.removeEventListener('waffled:theme-changed', spy)
  })
})

describe('sun schedule', () => {
  // Local wall-clock at the household location, as the weather endpoint returns.
  const SUNRISE = '2026-07-14T05:44'
  const SUNSET = '2026-07-14T20:32'

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sunPrefersDark is null until sun times are known', () => {
    expect(sunPrefersDark()).toBeNull()
  })

  it('resolveTheme("sun") falls back to the OS before sun times arrive', () => {
    const mm = installMatchMedia(false)
    expect(resolveTheme('sun')).toBe('light')
    mm.set(true)
    expect(resolveTheme('sun')).toBe('dark')
  })

  it('is light during the day, dark after sunset and before sunrise', () => {
    vi.useFakeTimers()
    setSunTimes(SUNRISE, SUNSET)
    vi.setSystemTime(new Date(2026, 6, 14, 12, 0)) // midday
    expect(sunPrefersDark()).toBe(false)
    expect(resolveTheme('sun')).toBe('light')
    vi.setSystemTime(new Date(2026, 6, 14, 21, 0)) // after sunset
    expect(sunPrefersDark()).toBe(true)
    expect(resolveTheme('sun')).toBe('dark')
    vi.setSystemTime(new Date(2026, 6, 15, 4, 30)) // pre-dawn next day
    expect(sunPrefersDark()).toBe(true)
  })

  it('readPref accepts a stored "sun" preference', () => {
    localStorage.setItem(THEME_KEY, 'sun')
    expect(readPref()).toBe('sun')
  })

  it('setSunTimes re-applies the theme when preference is "sun"', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 14, 21, 0)) // night
    installMatchMedia(false) // OS says light — sun schedule must win
    setPref('sun') // no times yet → resolves via OS → light
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    const spy = vi.fn()
    window.addEventListener('waffled:theme-changed', spy)
    setSunTimes(SUNRISE, SUNSET) // times arrive → it's night → flips dark
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(spy).toHaveBeenCalledOnce()
    window.removeEventListener('waffled:theme-changed', spy)
  })

  it('ignores malformed sun times', () => {
    setSunTimes('garbage', 'also-garbage')
    expect(localStorage.getItem(SUN_KEY)).toBeNull()
    expect(sunPrefersDark()).toBeNull()
  })

  it('persists sun times for the next load', () => {
    setSunTimes(SUNRISE, SUNSET)
    expect(JSON.parse(localStorage.getItem(SUN_KEY) as string)).toEqual({
      sunrise: SUNRISE,
      sunset: SUNSET,
    })
  })
})

describe('color palette store', () => {
  it('defaults to "waffle" when nothing is stored', () => {
    expect(readPalette()).toBe('waffle')
  })

  it('persists a chosen palette and stamps data-palette on the root', () => {
    setPalette('blueberry')
    expect(localStorage.getItem(PALETTE_KEY)).toBe('blueberry')
    expect(readPalette()).toBe('blueberry')
    expect(document.documentElement.getAttribute('data-palette')).toBe('blueberry')
  })

  it('ignores a garbage stored value and falls back to "waffle"', () => {
    localStorage.setItem(PALETTE_KEY, 'chartreuse')
    expect(readPalette()).toBe('waffle')
  })

  it('applyPalette stamps data-palette on the document root', () => {
    applyPalette('matcha')
    expect(document.documentElement.getAttribute('data-palette')).toBe('matcha')
    applyPalette('waffle')
    expect(document.documentElement.getAttribute('data-palette')).toBe('waffle')
  })

  it('initTheme applies the stored palette on boot', () => {
    installMatchMedia(false)
    localStorage.setItem(PALETTE_KEY, 'lavender')
    initTheme()
    expect(document.documentElement.getAttribute('data-palette')).toBe('lavender')
  })

  it('initTheme stamps the default palette when nothing is stored', () => {
    installMatchMedia(false)
    initTheme()
    expect(document.documentElement.getAttribute('data-palette')).toBe('waffle')
  })

  it('emits a waffled:theme-changed event on setPalette', () => {
    const spy = vi.fn()
    window.addEventListener('waffled:theme-changed', spy)
    setPalette('tidepool')
    expect(spy).toHaveBeenCalledOnce()
    window.removeEventListener('waffled:theme-changed', spy)
  })

  it('the catalog starts with the default and every entry is complete', () => {
    expect(PALETTES[0].id).toBe('waffle')
    // Every palette drives a picker card: it needs a label, an emoji, a blurb,
    // and a three-color swatch preview.
    for (const p of PALETTES) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.emoji.length).toBeGreaterThan(0)
      expect(p.sub.length).toBeGreaterThan(0)
      expect(p.swatch).toHaveLength(3)
      for (const c of p.swatch) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
    // Ids are unique (they key localStorage + the data-palette attribute).
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length)
    // "A variety of options" — the default plus at least six colorful themes.
    expect(PALETTES.length).toBeGreaterThanOrEqual(7)
  })

  it('every stored palette id round-trips through readPalette', () => {
    for (const p of PALETTES) {
      localStorage.setItem(PALETTE_KEY, p.id)
      expect(readPalette()).toBe(p.id)
    }
  })
})

// Type-only guard: ThemePref is the four-value union we expect.
const _pref: ThemePref[] = ['light', 'dark', 'system', 'sun']
void _pref
// Type-only guard: PaletteId includes the default.
const _pal: PaletteId = 'waffle'
void _pal
