// Theme store — light / dark / follow-the-OS.
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

import { useSyncExternalStore } from 'react'

export type ThemePref = 'light' | 'dark' | 'system' | 'sun'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_KEY = 'waffled:theme'
export const SUN_KEY = 'waffled:sun-times'
const DARK_MQ = '(prefers-color-scheme: dark)'

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

// Snapshot encodes BOTH the preference and the resolved theme, so a live OS flip
// (pref stays 'system' but resolved changes) still produces a new snapshot and
// re-renders — a bare pref snapshot would be identical and bail out.
function snapshot(): string {
  const p = readPref()
  return `${p}|${resolveTheme(p)}`
}

export function useThemePref(): {
  pref: ThemePref
  resolved: ResolvedTheme
  setPref: (p: ThemePref) => void
} {
  const snap = useSyncExternalStore(subscribe, snapshot, () => 'system|light')
  const [pref, resolved] = snap.split('|') as [ThemePref, ResolvedTheme]
  return { pref, resolved, setPref }
}
