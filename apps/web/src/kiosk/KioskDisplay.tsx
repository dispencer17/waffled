// The always-on "family display" layer. Wraps the whole app (above AuthGate, so it
// also covers the profile picker). When display mode is OFF (a normal/dev browser) it
// renders nothing extra — zero behavior, no screensaver. When ON it keeps the screen
// awake, runs one idle watcher (reset-to-Today, then screensaver), shows the
// screensaver overlay, and applies night dimming on a schedule.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router'
import {
  isDisplayMode,
  isKioskMode,
  clearProfileSession,
  kioskApi,
  useWeather,
  useEventsToday,
  usePhotos,
  useHousehold,
  type DisplayConfig,
  type AgendaEvent,
} from '../lib/api'
import { Screensaver, screensaverPhotos } from './components/Screensaver'
import { startBuildWatch } from '../lib/build-watch'
import '../styles/kiosk-profiles.css'

export function KioskDisplay({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(isDisplayMode())
  useEffect(() => {
    const h = () => setOn(isDisplayMode())
    window.addEventListener('waffled:auth-changed', h)
    return () => window.removeEventListener('waffled:auth-changed', h)
  }, [])
  return (
    <>
      {children}
      {on && <DisplayLayer />}
    </>
  )
}

function nextUpcoming(events: AgendaEvent[]): AgendaEvent | null {
  const now = Date.now()
  return (
    events
      .filter((e) => new Date(e.startsAt).getTime() > now)
      .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))[0] ?? null
  )
}

// "HH:MM" now in the household tz, for the night-dim window check (handles overnight).
function inNightWindow(start: string, end: string, tz?: string): boolean {
  const cur = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz || undefined }).slice(0, 5)
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end
}

function DisplayLayer() {
  const navigate = useNavigate()
  const location = useLocation()
  const { household } = useHousehold()
  const wx = useWeather()
  const { events } = useEventsToday()
  const { photos } = usePhotos()
  const [cfg, setCfg] = useState<DisplayConfig | null>(null)
  const saverPhotos = useMemo(() => screensaverPhotos(photos, cfg ?? {}), [photos, cfg])
  const [saver, setSaver] = useState(false)
  const [dim, setDim] = useState(false)
  const locRef = useRef(location.pathname)
  locRef.current = location.pathname
  // For the build watch: when the tablet was last touched, and whether the
  // screensaver is up (screensaver = definitionally idle).
  const lastActivity = useRef(Date.now())
  const saverRef = useRef(saver)
  saverRef.current = saver

  // Keep the screen awake while this is the family display.
  useEffect(() => {
    let cancelled = false
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => void }> } }
    let lock: { release: () => void } | null = null
    nav.wakeLock?.request('screen').then((s) => { if (cancelled) s.release(); else lock = s }).catch(() => {})
    return () => { cancelled = true; lock?.release() }
  }, [])

  // Load settings; refresh on focus, session change, an explicit save from this
  // browser (waffled:display-changed), and poll every 2 min so an always-on kiosk picks
  // up admin edits made elsewhere (it never blurs, so focus alone isn't enough).
  useEffect(() => {
    // Keep the same object reference when nothing changed, so polling doesn't churn
    // the idle effect (which depends on cfg) and perpetually re-arm the timers.
    const load = () =>
      kioskApi.displayConfig()
        .then((c) => setCfg((prev) => (prev && JSON.stringify(prev) === JSON.stringify(c) ? prev : c)))
        .catch(() => {})
    load()
    const onVis = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('waffled:auth-changed', load)
    window.addEventListener('waffled:display-changed', load)
    const poll = setInterval(load, 120_000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('waffled:auth-changed', load)
      window.removeEventListener('waffled:display-changed', load)
      clearInterval(poll)
    }
  }, [])

  // Idle watcher (only while the screensaver is NOT up): reset-to-Today, then screensaver.
  useEffect(() => {
    if (!cfg || saver) return
    let homeT: ReturnType<typeof setTimeout> | undefined
    let saverT: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      lastActivity.current = Date.now() // feeds the build-watch idle check
      clearTimeout(homeT); clearTimeout(saverT)
      if (cfg.resetHomeMinutes > 0) {
        homeT = setTimeout(() => { if (locRef.current !== '/') navigate('/') }, cfg.resetHomeMinutes * 60_000)
      }
      if (cfg.content !== 'off') {
        saverT = setTimeout(() => {
          if (isKioskMode() && cfg.returnToPicker) clearProfileSession() // drop to picker underneath
          setSaver(true)
        }, cfg.screensaverMinutes * 60_000)
      }
    }
    const evs = ['pointerdown', 'keydown', 'pointermove', 'wheel', 'touchstart']
    evs.forEach((e) => window.addEventListener(e, arm, { passive: true }))
    arm()
    return () => { clearTimeout(homeT); clearTimeout(saverT); evs.forEach((e) => window.removeEventListener(e, arm)) }
  }, [cfg, saver, navigate])

  // While the screensaver is up, any interaction wakes it.
  useEffect(() => {
    if (!saver) return
    const wake = () => setSaver(false)
    const evs = ['pointerdown', 'keydown', 'touchstart']
    evs.forEach((e) => window.addEventListener(e, wake, { passive: true }))
    return () => evs.forEach((e) => window.removeEventListener(e, wake))
  }, [saver])

  // Auto-update: when the server starts serving a new build (update.ps1 ran),
  // reload once nobody's using the display — screensaver counts as idle — so the
  // always-on tablet picks up fork updates without anyone touching it.
  useEffect(
    () =>
      startBuildWatch({
        idleMs: () => (saverRef.current ? Infinity : Date.now() - lastActivity.current),
      }),
    []
  )

  // Night dimming on a schedule. 'sunset'/'sunrise' resolve from today's sun
  // times (weather endpoint, wall-clock at the household location) with fixed
  // fallbacks until the first weather fetch lands.
  useEffect(() => {
    if (!cfg?.nightDim.enabled) { setDim(false); return }
    const hhmm = (iso?: string) => iso ? /T(\d{2}:\d{2})/.exec(iso)?.[1] : undefined
    const start = cfg.nightDim.start === 'sunset' ? (hhmm(wx?.sunset) ?? '20:00') : cfg.nightDim.start
    const end = cfg.nightDim.end === 'sunrise' ? (hhmm(wx?.sunrise) ?? '07:00') : cfg.nightDim.end
    const tick = () => setDim(inNightWindow(start, end, household?.timezone))
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [cfg, household?.timezone, wx?.sunrise, wx?.sunset])

  return (
    <>
      {dim && <div className="kiosk-dim" aria-hidden="true" />}
      {saver && cfg && cfg.content !== 'off' && (
        <Screensaver
          content={cfg.content === 'photos' ? 'photos' : 'clock'}
          photos={saverPhotos}
          weather={wx}
          nextEvent={nextUpcoming(events)}
          timezone={household?.timezone}
          intervalSeconds={cfg?.photoInterval}
          onWake={() => setSaver(false)}
        />
      )}
    </>
  )
}
