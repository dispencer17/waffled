import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SyncHealthMonitor,
  type SyncHealthMonitorDeps,
  getSyncHealth,
  subscribeSyncHealth,
  publishSyncHealth,
  isReplicaTrusted,
  STALL_AFTER_MS,
  RESTART_BACKOFF_BASE_MS,
  RESTART_BACKOFF_MAX_MS,
  __resetSyncHealthForTests,
} from './sync-health'

// A monitor with a hand-cranked clock and spy restarts. Ticks are driven
// manually — the interval wiring is trivial and exercised in db.restart tests.
function makeMonitor(over: Partial<SyncHealthMonitorDeps> = {}) {
  let now = 1_000_000
  const deps = {
    isOnline: vi.fn(() => true),
    isAuthenticated: vi.fn(() => true),
    softRestart: vi.fn(async () => {}),
    hardRestart: vi.fn(async () => {}),
    now: () => now,
    ...over,
  }
  const m = new SyncHealthMonitor(deps)
  return {
    m,
    deps,
    advance: (ms: number) => {
      now += ms
    },
  }
}

const CONNECTED = { connected: true, connecting: false, hasSynced: true, lastSyncedAt: 999_000 }
const DISCONNECTED = { connected: false, connecting: false, hasSynced: true, lastSyncedAt: 999_000 }

beforeEach(() => {
  __resetSyncHealthForTests()
})

describe('SyncHealthMonitor status', () => {
  it('starts off (PowerSync not running)', () => {
    makeMonitor()
    expect(getSyncHealth().status).toBe('off')
  })

  it('reports connecting after engine start, ok once connected+synced', async () => {
    const { m } = makeMonitor()
    m.engineStarted()
    await m.tick()
    expect(getSyncHealth().status).toBe('connecting')
    m.noteStatus(CONNECTED)
    expect(getSyncHealth().status).toBe('ok')
    expect(getSyncHealth().lastSyncedAt).toBe(999_000)
    expect(getSyncHealth().hasSynced).toBe(true)
  })

  it('a short disconnect is just connecting, not stalled', async () => {
    const { m, advance } = makeMonitor()
    m.engineStarted()
    m.noteStatus(CONNECTED)
    m.noteStatus(DISCONNECTED)
    advance(STALL_AFTER_MS / 2)
    await m.tick()
    expect(getSyncHealth().status).toBe('connecting')
  })

  it('flags stalled when disconnected past the stall window while online+authed', async () => {
    const { m, advance } = makeMonitor()
    m.engineStarted()
    m.noteStatus(CONNECTED)
    m.noteStatus(DISCONNECTED)
    advance(STALL_AFTER_MS + 1)
    await m.tick()
    expect(getSyncHealth().status).toBe('stalled')
  })

  it('flags stalled when connected but the first sync never completes (wedged bootstrap)', async () => {
    const { m, advance } = makeMonitor()
    m.engineStarted()
    m.noteStatus({ connected: true, connecting: false, hasSynced: false, lastSyncedAt: null })
    advance(STALL_AFTER_MS + 1)
    await m.tick()
    expect(getSyncHealth().status).toBe('stalled')
  })

  it('offline suppresses the stall (and resets the grace window)', async () => {
    let online = true
    const { m, advance, deps } = makeMonitor({ isOnline: () => online })
    m.engineStarted()
    m.noteStatus(CONNECTED)
    m.noteStatus(DISCONNECTED)
    online = false
    advance(STALL_AFTER_MS * 5)
    await m.tick()
    expect(getSyncHealth().status).toBe('offline')
    expect(deps.softRestart).not.toHaveBeenCalled()
    // Back online: the offline stretch must not count toward the stall window.
    online = true
    await m.tick()
    expect(getSyncHealth().status).toBe('connecting')
    advance(STALL_AFTER_MS + 1)
    await m.tick()
    expect(getSyncHealth().status).toBe('stalled')
  })

  it('signed-out suppresses the stall (nothing to sync without credentials)', async () => {
    const { m, advance, deps } = makeMonitor({ isAuthenticated: vi.fn(() => false) })
    m.engineStarted()
    m.noteStatus(DISCONNECTED)
    advance(STALL_AFTER_MS * 5)
    await m.tick()
    expect(getSyncHealth().status).toBe('no-auth')
    expect(deps.softRestart).not.toHaveBeenCalled()
  })

  it('engineStopped returns to off', async () => {
    const { m } = makeMonitor()
    m.engineStarted()
    m.noteStatus(CONNECTED)
    m.engineStopped()
    expect(getSyncHealth().status).toBe('off')
  })
})

describe('SyncHealthMonitor restarts', () => {
  async function stall(m: SyncHealthMonitor, advance: (ms: number) => void) {
    m.engineStarted()
    m.noteStatus(CONNECTED)
    m.noteStatus(DISCONNECTED)
    advance(STALL_AFTER_MS + 1)
    await m.tick()
  }

  it('soft-restarts once when the stall is first detected', async () => {
    const { m, deps, advance } = makeMonitor()
    await stall(m, advance)
    expect(deps.softRestart).toHaveBeenCalledTimes(1)
    expect(deps.hardRestart).not.toHaveBeenCalled()
    expect(getSyncHealth().restartCount).toBe(1)
    expect(getSyncHealth().lastRestartAt).not.toBeNull()
  })

  it('does not restart again before the backoff elapses', async () => {
    const { m, deps, advance } = makeMonitor()
    await stall(m, advance)
    advance(RESTART_BACKOFF_BASE_MS / 2)
    await m.tick()
    expect(deps.softRestart).toHaveBeenCalledTimes(1)
    expect(deps.hardRestart).not.toHaveBeenCalled()
  })

  it('escalates to a hard restart when the soft one did not recover', async () => {
    const { m, deps, advance } = makeMonitor()
    await stall(m, advance)
    advance(RESTART_BACKOFF_BASE_MS + 1)
    await m.tick()
    expect(deps.hardRestart).toHaveBeenCalledTimes(1)
    expect(getSyncHealth().restartCount).toBe(2)
  })

  it('doubles the backoff between attempts and caps it', async () => {
    const { m, deps, advance } = makeMonitor()
    await stall(m, advance) // attempt 1 (soft)
    advance(RESTART_BACKOFF_BASE_MS + 1)
    await m.tick() // attempt 2 (hard)
    // Next backoff is base*2 — a tick after only base must not restart.
    advance(RESTART_BACKOFF_BASE_MS + 1)
    await m.tick()
    expect(deps.hardRestart).toHaveBeenCalledTimes(1)
    advance(RESTART_BACKOFF_BASE_MS + 1)
    await m.tick() // attempt 3
    expect(deps.hardRestart).toHaveBeenCalledTimes(2)
    // Ladder never exceeds the cap no matter how many attempts.
    for (let i = 0; i < 10; i++) {
      advance(RESTART_BACKOFF_MAX_MS + 1)
      await m.tick()
    }
    expect(vi.mocked(deps.hardRestart).mock.calls.length).toBeGreaterThanOrEqual(12)
  })

  it('recovery resets the ladder: the next stall starts soft again', async () => {
    const { m, deps, advance } = makeMonitor()
    await stall(m, advance)
    advance(RESTART_BACKOFF_BASE_MS + 1)
    await m.tick() // hard
    m.noteStatus(CONNECTED) // recovered
    expect(getSyncHealth().status).toBe('ok')
    m.noteStatus(DISCONNECTED)
    advance(STALL_AFTER_MS + 1)
    await m.tick()
    expect(deps.softRestart).toHaveBeenCalledTimes(2)
    expect(deps.hardRestart).toHaveBeenCalledTimes(1)
  })

  it('a throwing restart is tolerated and still paced by the backoff', async () => {
    const { m, deps, advance } = makeMonitor({ softRestart: vi.fn(async () => { throw new Error('boom') }) })
    await stall(m, advance)
    expect(deps.softRestart).toHaveBeenCalledTimes(1)
    await m.tick() // immediately after — inside backoff
    expect(deps.softRestart).toHaveBeenCalledTimes(1)
    expect(deps.hardRestart).not.toHaveBeenCalled()
  })
})

describe('sync health store', () => {
  it('notifies subscribers on change and supports unsubscribe', () => {
    const cb = vi.fn()
    const off = subscribeSyncHealth(cb)
    publishSyncHealth({ status: 'ok', hasSynced: true, lastSyncedAt: 1, restartCount: 0, lastRestartAt: null })
    expect(cb).toHaveBeenCalledTimes(1)
    // Publishing an identical snapshot is a no-op (no render churn).
    publishSyncHealth({ status: 'ok', hasSynced: true, lastSyncedAt: 1, restartCount: 0, lastRestartAt: null })
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    publishSyncHealth({ status: 'stalled', hasSynced: true, lastSyncedAt: 1, restartCount: 1, lastRestartAt: 2 })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(getSyncHealth().status).toBe('stalled')
  })
})

describe('isReplicaTrusted', () => {
  const base = { lastSyncedAt: 1, restartCount: 0, lastRestartAt: null }
  it('trusts a synced replica that is ok, connecting, or offline', () => {
    for (const status of ['ok', 'connecting', 'offline', 'no-auth'] as const) {
      publishSyncHealth({ status, hasSynced: true, ...base })
      expect(isReplicaTrusted(), status).toBe(true)
    }
  })
  it('never trusts a stalled engine — REST must drive the UI', () => {
    publishSyncHealth({ status: 'stalled', hasSynced: true, ...base })
    expect(isReplicaTrusted()).toBe(false)
  })
  it('never trusts a replica that has not completed a first sync', () => {
    publishSyncHealth({ status: 'ok', hasSynced: false, ...base })
    expect(isReplicaTrusted()).toBe(false)
    publishSyncHealth({ status: 'connecting', hasSynced: null, ...base })
    expect(isReplicaTrusted()).toBe(false)
  })
  it('does not trust when PowerSync is off entirely', () => {
    expect(getSyncHealth().status).toBe('off')
    expect(isReplicaTrusted()).toBe(false)
  })
})

// The 2026-07-21 report: the card said "off" during normal boot (≈5 s of WASM
// init) and would say the same if the engine crashed — indistinguishable. Boot
// is now 'starting' and a swallowed startClient error is 'failed' + message.
describe('starting / failed states', () => {
  it('engineStarting publishes starting (not off) until the engine is up', async () => {
    const { m } = makeMonitor()
    m.engineStarting()
    expect(getSyncHealth().status).toBe('starting')
    await m.tick()
    expect(getSyncHealth().status).toBe('starting')
    m.engineStarted()
    await m.tick()
    expect(getSyncHealth().status).toBe('connecting')
  })

  it('engineFailed publishes failed with the error message, and sticks', async () => {
    const { m } = makeMonitor()
    m.engineStarting()
    m.engineFailed(new Error('OPFS unavailable'))
    expect(getSyncHealth().status).toBe('failed')
    expect(getSyncHealth().lastError).toBe('OPFS unavailable')
    await m.tick()
    expect(getSyncHealth().status).toBe('failed')
  })

  it('a successful start after a failure clears the error', () => {
    const { m } = makeMonitor()
    m.engineFailed(new Error('boom'))
    m.engineStarting()
    m.engineStarted()
    expect(getSyncHealth().status).toBe('connecting')
    expect(getSyncHealth().lastError ?? null).toBeNull()
  })

  it('replica is never trusted while starting or failed', () => {
    const base = { hasSynced: true as const, lastSyncedAt: 1, restartCount: 0, lastRestartAt: null }
    publishSyncHealth({ status: 'failed', ...base })
    expect(isReplicaTrusted()).toBe(false)
    publishSyncHealth({ status: 'starting', ...base })
    expect(isReplicaTrusted()).toBe(false)
  })
})
