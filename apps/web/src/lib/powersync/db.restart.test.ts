import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fake @powersync/web: constructor-tracked instances so hard-restart tests can
// assert a NEW client was built (the real one owns the wedged worker we replace).
const fakes = vi.hoisted(() => ({ instances: [] as FakePowerSyncDatabase[] }))

class FakePowerSyncDatabase {
  listeners: Array<{ statusChanged?: (s: unknown) => void }> = []
  watchCalls: Array<{ sql: string; options: { signal?: AbortSignal } }> = []
  onChangeCalls: Array<{ handler: { onChange: () => void }; options: unknown }> = []
  init = vi.fn(async () => {})
  connect = vi.fn(async () => {})
  disconnect = vi.fn(async () => {})
  close = vi.fn(async () => {})
  currentStatus = { connected: false, connecting: true, hasSynced: false, lastSyncedAt: undefined }
  getOptional = vi.fn(async () => null)
  registerListener(l: { statusChanged?: (s: unknown) => void }) {
    this.listeners.push(l)
    return () => {}
  }
  onChange(handler: { onChange: () => void }, options: unknown) {
    this.onChangeCalls.push({ handler, options })
    return () => {}
  }
  watch(sql: string, _params: unknown[], _handler: unknown, options: { signal?: AbortSignal }) {
    this.watchCalls.push({ sql, options })
  }
  constructor(_opts: unknown) {
    fakes.instances.push(this)
  }
}

vi.mock('@powersync/web', () => ({ PowerSyncDatabase: FakePowerSyncDatabase }))
vi.mock('./schema', () => ({ AppSchema: {} }))

// The engine emits SyncStatus objects; the wiring only reads these fields.
const okStatus = { connected: true, connecting: false, hasSynced: true, lastSyncedAt: new Date(1_700_000_000_000) }

// vi.resetModules gives each test a fresh module graph — grab db AND the (also
// fresh, hence already-reset) sync-health store from the same graph.
let getSyncHealth: typeof import('./sync-health').getSyncHealth

async function freshDbModule() {
  vi.resetModules()
  const mod = await import('./db')
  ;({ getSyncHealth } = await import('./sync-health'))
  return mod
}

beforeEach(() => {
  fakes.instances.length = 0
  localStorage.setItem('waffled.access', 'tok') // authenticated, so health isn't pinned at no-auth
})

describe('connectPowerSync', () => {
  it('creates and connects a single client (second call is a no-op)', async () => {
    const db = await freshDbModule()
    await db.connectPowerSync()
    await db.connectPowerSync()
    expect(fakes.instances).toHaveLength(1)
    expect(fakes.instances[0].init).toHaveBeenCalledTimes(1)
    expect(fakes.instances[0].connect).toHaveBeenCalledTimes(1)
    expect(db.getPowerSyncDb()).toBe(fakes.instances[0] as never)
  })

  it('feeds engine status into the sync-health store', async () => {
    const db = await freshDbModule()
    await db.connectPowerSync()
    const listener = fakes.instances[0].listeners.find((l) => l.statusChanged)
    expect(listener).toBeTruthy()
    listener!.statusChanged!(okStatus)
    expect(getSyncHealth().status).toBe('ok')
    expect(getSyncHealth().lastSyncedAt).toBe(1_700_000_000_000)
  })
})

describe('restartPowerSyncSoft', () => {
  it('disconnects and reconnects the same client', async () => {
    const db = await freshDbModule()
    await db.connectPowerSync()
    await db.restartPowerSyncSoft()
    expect(fakes.instances).toHaveLength(1)
    expect(fakes.instances[0].disconnect).toHaveBeenCalledTimes(1)
    expect(fakes.instances[0].connect).toHaveBeenCalledTimes(2)
  })

  it('is a safe no-op when PowerSync never came up', async () => {
    const db = await freshDbModule()
    await expect(db.restartPowerSyncSoft()).resolves.toBeUndefined()
  })
})

describe('restartPowerSyncHard', () => {
  it('closes the old client and builds + connects a fresh one', async () => {
    const db = await freshDbModule()
    await db.connectPowerSync()
    const old = fakes.instances[0]
    await db.restartPowerSyncHard()
    expect(old.close).toHaveBeenCalledTimes(1)
    expect(fakes.instances).toHaveLength(2)
    expect(fakes.instances[1].connect).toHaveBeenCalledTimes(1)
    expect(db.getPowerSyncDb()).toBe(fakes.instances[1] as never)
  })

  it('re-wires status events from the new client into the health store', async () => {
    const db = await freshDbModule()
    await db.connectPowerSync()
    await db.restartPowerSyncHard()
    const listener = fakes.instances[1].listeners.find((l) => l.statusChanged)
    expect(listener).toBeTruthy()
    listener!.statusChanged!(okStatus)
    expect(getSyncHealth().status).toBe('ok')
  })

  it('notifies onPowerSyncRecreated subscribers (and disposers stop that)', async () => {
    const db = await freshDbModule()
    await db.connectPowerSync()
    const cb = vi.fn()
    const off = db.onPowerSyncRecreated(cb)
    await db.restartPowerSyncHard()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    await db.restartPowerSyncHard()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('re-arms onTablesChange subscriptions on the new client', async () => {
    const db = await freshDbModule()
    await db.connectPowerSync()
    const dispose = db.onTablesChange(['events'], () => {})
    expect(fakes.instances[0].onChangeCalls).toHaveLength(1)
    await db.restartPowerSyncHard()
    expect(fakes.instances[1].onChangeCalls).toHaveLength(1)
    dispose()
    await db.restartPowerSyncHard()
    expect(fakes.instances[2].onChangeCalls).toHaveLength(0)
  })
})

describe('watchAgendaRows across a hard restart', () => {
  it('re-arms the agenda watch on the new client until disposed', async () => {
    const db = await freshDbModule()
    const { watchAgendaRows } = await import('./events-local')
    await db.connectPowerSync()
    const dispose = watchAgendaRows(() => {})
    expect(fakes.instances[0].watchCalls).toHaveLength(1)
    await db.restartPowerSyncHard()
    expect(fakes.instances[1].watchCalls).toHaveLength(1)
    dispose()
    await db.restartPowerSyncHard()
    expect(fakes.instances[2].watchCalls).toHaveLength(0)
  })
})
