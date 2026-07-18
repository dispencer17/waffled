// Kiosk auto-update (fork): the always-on display reloads itself when the
// server starts serving a NEW build of the web app, so `update.ps1` on the
// server is the only manual step in the whole update chain.
//
// Detection is deliberately dumb and API-free: Vite content-hashes the entry
// bundle (/assets/index-<hash>.js), so "a new build is deployed" is exactly
// "the app shell references a different bundle file than the one this page is
// running". We re-fetch the shell on an interval and compare. The reload waits
// for the display to be idle (or on the screensaver) so it never yanks the UI
// out from under someone mid-tap.

export function currentBundleFile(doc: Document = document): string | null {
  const s = doc.querySelector<HTMLScriptElement>('script[src*="/assets/index-"]')
  const m = s?.getAttribute('src')?.match(/\/assets\/(index-[^/]+\.js)/)
  return m ? m[1] : null
}

async function fetchServedBundleFile(): Promise<string | null> {
  try {
    const res = await fetch('/', { cache: 'no-store' })
    if (!res.ok) return null
    const m = (await res.text()).match(/\/assets\/(index-[^"']+\.js)/)
    return m ? m[1] : null
  } catch {
    return null // offline / server restarting — try again next tick
  }
}

export interface BuildWatchOptions {
  /** ms since the last user interaction (return Infinity while the screensaver is up). */
  idleMs: () => number
  /** Poll cadence. Default 5 minutes. */
  intervalMs?: number
  /** Required idle stretch before reloading. Default 10 minutes. */
  minIdleMs?: number
  /** Injectable for tests. Default: location.reload(). */
  reload?: () => void
}

/** Start watching for a newer deployed build; returns a stop function. */
export function startBuildWatch(opts: BuildWatchOptions): () => void {
  const intervalMs = opts.intervalMs ?? 5 * 60_000
  const minIdleMs = opts.minIdleMs ?? 10 * 60_000
  const reload = opts.reload ?? (() => window.location.reload())
  const running = currentBundleFile()
  if (!running) return () => {} // dev server — no hashed bundle, nothing to compare
  let newBuildSeen = false
  let reloaded = false
  const id = setInterval(async () => {
    if (!newBuildSeen) {
      const served = await fetchServedBundleFile()
      if (served && served !== running) newBuildSeen = true
    }
    if (newBuildSeen && !reloaded && opts.idleMs() >= minIdleMs) {
      reloaded = true // reload can be async in tests — never double-fire
      reload()
    }
  }, intervalMs)
  return () => clearInterval(id)
}
