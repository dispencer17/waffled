import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { currentBundleFile, startBuildWatch } from './build-watch'

// The kiosk auto-reload: poll the served app shell for its hashed bundle name;
// when it differs from the bundle this page is running, reload once idle.

const OLD = 'index-AAAA1111.js'
const NEW = 'index-BBBB2222.js'

function installScriptTag(file: string) {
  const s = document.createElement('script')
  s.src = `/assets/${file}`
  document.head.appendChild(s)
  return s
}

function mockShell(file: () => string) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    text: async () => `<!doctype html><script type="module" crossorigin src="/assets/${file()}"></script>`,
  })) as unknown as typeof fetch
}

let tag: HTMLScriptElement | null = null
let stop: (() => void) | null = null

beforeEach(() => {
  vi.useFakeTimers()
  tag = installScriptTag(OLD)
})
afterEach(() => {
  stop?.()
  stop = null
  tag?.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const MIN = 60_000 // one tick per minute in these tests

describe('currentBundleFile', () => {
  it('reads the hashed bundle name from the running page', () => {
    expect(currentBundleFile()).toBe(OLD)
  })
})

describe('startBuildWatch', () => {
  it('does nothing while the served bundle matches the running one', async () => {
    mockShell(() => OLD)
    const reload = vi.fn()
    stop = startBuildWatch({ intervalMs: MIN, minIdleMs: 0, idleMs: () => Infinity, reload })
    await vi.advanceTimersByTimeAsync(MIN * 5)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once a new bundle is served and the display is idle', async () => {
    let served = OLD
    mockShell(() => served)
    const reload = vi.fn()
    stop = startBuildWatch({ intervalMs: MIN, minIdleMs: 0, idleMs: () => Infinity, reload })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(reload).not.toHaveBeenCalled()
    served = NEW // server was rebuilt
    await vi.advanceTimersByTimeAsync(MIN)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('holds the reload while someone is using the display, then fires when idle', async () => {
    mockShell(() => NEW)
    const reload = vi.fn()
    let idle = 0 // actively in use
    stop = startBuildWatch({ intervalMs: MIN, minIdleMs: 10 * MIN, idleMs: () => idle, reload })
    await vi.advanceTimersByTimeAsync(MIN * 3)
    expect(reload).not.toHaveBeenCalled() // new build known, but user active
    idle = 11 * MIN // walked away
    await vi.advanceTimersByTimeAsync(MIN)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('keeps waiting when the shell is temporarily unreachable', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    const reload = vi.fn()
    stop = startBuildWatch({ intervalMs: MIN, minIdleMs: 0, idleMs: () => Infinity, reload })
    await vi.advanceTimersByTimeAsync(MIN * 3)
    expect(reload).not.toHaveBeenCalled()
  })

  it('is inert when the page has no hashed bundle (dev server)', async () => {
    tag?.remove()
    mockShell(() => NEW)
    const reload = vi.fn()
    stop = startBuildWatch({ intervalMs: MIN, minIdleMs: 0, idleMs: () => Infinity, reload })
    await vi.advanceTimersByTimeAsync(MIN * 3)
    expect(reload).not.toHaveBeenCalled()
  })
})
