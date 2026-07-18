// Theme store — light / dark / follow-the-OS, plus a color palette axis.
//
// The palette lives entirely in CSS custom properties (styles/waffled.css). This
// module only decides which resolved theme is active and stamps it onto the
// document root as `data-theme="light|dark"`, which the `:root[data-theme="dark"]`
// override block keys off of. Nothing here knows about individual colors.
//
// Preference model:
//   'light' | 'dark'  → pinned, ignores the OS
//   'system'          → mirrors prefers-color-scheme and follows live OS changes
//   'sun'             → dark from sunset to sunrise (household sun times fed by
//                       the weather endpoint); falls back to 'system' until times arrive
// Default is 'system' so a fresh install matches the device out of the box.
//
// The COLOR PALETTE is a second, independent axis: it re-hues the brand accent and
// subtly tints every surface, in both light and dark, via `data-palette="<id>"` on
// the root (CSS override blocks in styles/waffled.css key off it). Stored per
// device like the light/dark preference.

import { useSyncExternalStore } from 'react'

export type ThemePref = 'light' | 'dark' | 'system' | 'sun'
export type ResolvedTheme = 'light' | 'dark'
export type PaletteId =
  | 'waffle'
  | 'flamingo'
  | 'honey'
  | 'matcha'
  | 'tidepool'
  | 'blueberry'
  | 'lavender'
  | 'sundae'

export const THEME_KEY = 'waffled:theme'
export const SUN_KEY = 'waffled:sun-times'
export const PALETTE_KEY = 'waffled:palette'
const DARK_MQ = '(prefers-color-scheme: dark)'

// The picker catalog. `swatch` is [primary, canvas tint, dark canvas] — enough for
// a mini preview card without loading the palette itself. Order = picker order,
// default first.
export interface PaletteDef {
  id: PaletteId
  label: string
  emoji: string
  sub: string
  swatch: [string, string, string]
}

export const PALETTES: PaletteDef[] = [
  { id: 'waffle', label: 'Golden Waffle', emoji: '🧇', sub: 'The classic — warm cream & coral.', swatch: ['#EC6049', '#FAF7F2', '#14110C'] },
  { id: 'flamingo', label: 'Flamingo', emoji: '🦩', sub: 'Playful pink with a rosy glow.', swatch: ['#E23D8E', '#FBF3F7', '#180F14'] },
  { id: 'sundae', label: 'Cherry Sundae', emoji: '🍒', sub: 'Bold cherry red, whipped-cream white.', swatch: ['#CE2D3F', '#FBF4F2', '#170F0F'] },
  { id: 'honey', label: 'Honey', emoji: '🍯', sub: 'Amber and golden toast.', swatch: ['#D9730D', '#FAF5EA', '#171205'] },
  { id: 'matcha', label: 'Matcha', emoji: '🍵', sub: 'Calm leafy green.', swatch: ['#2F8F5B', '#F3F8F0', '#0E140F'] },
  { id: 'tidepool', label: 'Tide Pool', emoji: '🌊', sub: 'Cool teal & sea glass.', swatch: ['#0E8598', '#F0F7F8', '#0C1416'] },
  { id: 'blueberry', label: 'Blueberry', emoji: '🫐', sub: 'Crisp blue on a cool canvas.', swatch: ['#3A66D4', '#F3F5FB', '#0F1219'] },
  { id: 'lavender', label: 'Lavender', emoji: '🪻', sub: 'Soft violet, a little dreamy.', swatch: ['#7A4FD6', '#F6F4FB', '#120F19'] },
]

const PALETTE_IDS = new Set<string>(PALETTES.map((p) => p.id))

/** The stored preference, defaulting to 'system' (also for any garbage value). */
export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system' || v === 'sun') return v
  } catch {
    // localStorage can throw in private-mode / sandboxed contexts — treat as unset.
  }
  return 'system'
}

/** The stored color palette, defaulting to 'waffle' (also for any garbage value). */
export function readPalette(): PaletteId {
  try {
    const v = localStorage.getItem(PALETTE_KEY)
    if (v && PALETTE_IDS.has(v)) return v as PaletteId
  } catch {
    // Same private-mode caveat as readPref — treat as unset.
  }
  return 'waffle'
}

/** Stamp the palette onto <html data-palette> (always, so CSS keys stay simple). */
export function applyPalette(palette: PaletteId): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-palette', palette)
  }
}

/** Persist a palette, apply it, and notify listeners (same event as light/dark). */
export function setPalette(palette: PaletteId): void {
  try {
    localStorage.setItem(PALETTE_KEY, palette)
  } catch {
    // Non-fatal: the choice just won't survive a reload.
  }
  applyPalette(palette)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('waffled:theme-changed'))
  }
}

/** Whether the OS currently prefers a dark color scheme. */
export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(DARK_MQ).matches
}

// --- Sun times ---------------------------------------------------------------
// Fed by the weather endpoint (local wall-clock ISO at the household location,
// e.g. "2026-07-14T05:44") and persisted so a reload before the first weather
// fetch still has yesterday's times — sun times drift ~1 min/day, so comparing
// wall-clock HH:MM keeps a stale value harmless.

interface SunTimes { sunrise: string; sunset: string }

function hhmm(iso: string): string | null {
  const m = /T(\d{2}:\d{2})/.exec(iso)
  return m ? m[1] : null
}

// Read-through like readPref(): localStorage is the single source of truth, so
// a device where it throws simply behaves as "no times" and falls back to the OS.
function readSunTimes(): SunTimes | null {
  try {
    const raw = localStorage.getItem(SUN_KEY)
    const v = raw ? (JSON.parse(raw) as SunTimes) : null
    return v && hhmm(v.sunrise) && hhmm(v.sunset) ? v : null
  } catch {
    return null
  }
}

/** Record the household's sun times (call whenever weather data arrives). */
export function setSunTimes(sunrise?: string | null, sunset?: string | null): void {
  if (!sunrise || !sunset || !hhmm(sunrise) || !hhmm(sunset)) return
  try {
    localStorage.setItem(SUN_KEY, JSON.stringify({ sunrise, sunset }))
  } catch {
    // Non-fatal: 'sun' just keeps behaving like 'system' on this device.
  }
  if (readPref() === 'sun') reapply()
}

/** Dark right now per the sun schedule, or null when no times are known yet. */
export function sunPrefersDark(now: Date = new Date()): boolean | null {
  const t = readSunTimes()
  if (!t) return null
  const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return cur < (hhmm(t.sunrise) as string) || cur >= (hhmm(t.sunset) as string)
}

/** Resolve a preference to a concrete theme (an explicit choice always wins). */
export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref
  if (pref === 'sun') {
    const dark = sunPrefersDark()
    if (dark !== null) return dark ? 'dark' : 'light'
    // No sun times yet (fresh device, weather unconfigured) — behave like 'system'.
  }
  return systemPrefersDark() ? 'dark' : 'light'
}

// Re-resolve and, when the resolved theme actually changed, stamp + notify.
// Used by the sun tick and by setSunTimes so a flip re-renders subscribers.
function reapply(): void {
  if (typeof document === 'undefined') return
  const next = resolveTheme(readPref())
  if (document.documentElement.getAttribute('data-theme') === next) return
  applyTheme(next)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('waffled:theme-changed'))
  }
}

/** Stamp the resolved theme onto <html data-theme>. */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved)
  }
}

/** Persist a preference, apply it, and notify listeners (e.g. the Settings UI). */
export function setPref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // Non-fatal: the choice just won't survive a reload.
  }
  applyTheme(resolveTheme(pref))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('waffled:theme-changed'))
  }
}

// Apply the stored preference and wire up the OS listener so 'system' tracks
// live prefers-color-scheme changes. Explicit light/dark ignore the OS. Called
// once at startup; applyTheme is idempotent so a stray re-call is harmless.
export function initTheme(): void {
  applyTheme(resolveTheme(readPref()))
  applyPalette(readPalette())
  if (typeof window === 'undefined') return
  // Minute tick so 'sun' flips at sunset/sunrise without any interaction.
  // reapply() is a no-op unless the resolved theme actually changed.
  window.setInterval(() => {
    if (readPref() === 'sun') reapply()
  }, 60_000)
  if (!window.matchMedia) return
  const mq = window.matchMedia(DARK_MQ)
  const onChange = () => {
    if (readPref() === 'system') applyTheme(resolveTheme('system'))
  }
  // addEventListener is standard; addListener is the legacy Safari fallback.
  if (mq.addEventListener) mq.addEventListener('change', onChange)
  else if (mq.addListener) mq.addListener(onChange)
}

// --- React binding -----------------------------------------------------------

function subscribe(cb: () => void): () => void {
  window.addEventListener('waffled:theme-changed', cb)
  const mq = window.matchMedia?.(DARK_MQ)
  // addEventListener is standard; addListener is the legacy Safari < 14 fallback —
  // mirror initTheme() so useThemePref() consumers re-render on a live OS flip there too.
  if (mq?.addEventListener) mq.addEventListener('change', cb)
  else if (mq?.addListener) mq.addListener(cb)
  return () => {
    window.removeEventListener('waffled:theme-changed', cb)
    if (mq?.removeEventListener) mq.removeEventListener('change', cb)
    else if (mq?.removeListener) mq.removeListener(cb)
  }
}

// Snapshot encodes the preference, the resolved theme AND the palette, so a live
// OS flip (pref stays 'system' but resolved changes) or a palette switch each
// produce a new snapshot and re-render — a bare pref snapshot would be identical
// and bail out.
function snapshot(): string {
  const p = readPref()
  return `${p}|${resolveTheme(p)}|${readPalette()}`
}

export function useThemePref(): {
  pref: ThemePref
  resolved: ResolvedTheme
  palette: PaletteId
  setPref: (p: ThemePref) => void
  setPalette: (p: PaletteId) => void
} {
  const snap = useSyncExternalStore(subscribe, snapshot, () => 'system|light|waffle')
  const [pref, resolved, palette] = snap.split('|') as [ThemePref, ResolvedTheme, PaletteId]
  return { pref, resolved, palette, setPref, setPalette }
}
