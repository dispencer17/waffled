import { useEffect, useState } from 'react'

// Register the kiosk service worker (roadmap 7.1). Production only — in dev the
// SW would fight Vite's HMR. Safe to call unconditionally; it no-ops otherwise.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* registration failed — app still works online */
    })
  })
}

// ── Install prompt (fork) ─────────────────────────────────────────────────────
// Chrome/Android fires `beforeinstallprompt` when the PWA is installable; the
// browser hides it unless we stash the event and re-fire it from a user gesture.
// Captured at module scope so the event isn't lost before a component mounts.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const INSTALLABLE = 'waffled:installable'

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    window.dispatchEvent(new CustomEvent(INSTALLABLE))
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    window.dispatchEvent(new CustomEvent(INSTALLABLE))
  })
}

/** Install-to-home-screen: whether the browser offered it, and a trigger. */
export function useInstallPrompt(): { canInstall: boolean; promptInstall: () => Promise<boolean> } {
  const [canInstall, setCanInstall] = useState(deferredPrompt !== null)
  useEffect(() => {
    const sync = () => setCanInstall(deferredPrompt !== null)
    window.addEventListener(INSTALLABLE, sync)
    return () => window.removeEventListener(INSTALLABLE, sync)
  }, [])
  return {
    canInstall,
    promptInstall: async () => {
      const p = deferredPrompt
      if (!p) return false
      await p.prompt()
      const { outcome } = await p.userChoice
      if (outcome === 'accepted') deferredPrompt = null
      setCanInstall(deferredPrompt !== null)
      return outcome === 'accepted'
    },
  }
}

// How long the device must be *continuously* offline before the kiosk admits it.
// Brief blips (PowerSync reconnects, network transitions, tab wake-ups) resolve
// well inside this window, so the Offline banner doesn't flash on every hiccup.
export const OFFLINE_BANNER_GRACE_MS = 10_000

// Track connectivity so the kiosk can tell the family it's showing last-known state.
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

// Debounced offline signal for the banner: flips true only after the device has
// been continuously offline for the grace period (a reconnect cancels the pending
// flip and restarts the clock), and flips back false immediately on reconnect.
export function useSustainedOffline(graceMs: number = OFFLINE_BANNER_GRACE_MS): boolean {
  const online = useOnline()
  const [sustained, setSustained] = useState(false)
  useEffect(() => {
    if (online) {
      // Reset the stored flag so the next outage starts hidden; the return
      // below already hides the banner synchronously on this very render.
      setSustained(false)
      return
    }
    const timer = window.setTimeout(() => setSustained(true), graceMs)
    return () => window.clearTimeout(timer)
  }, [online, graceMs])
  // Clear in-render, not in the post-paint effect — otherwise the banner
  // paints one stale frame on the render where connectivity returns.
  return online ? false : sustained
}
