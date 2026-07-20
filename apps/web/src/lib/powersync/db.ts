// PowerSync client lifecycle. Lazily created and connected at app boot (real
// browser only) so the test/jsdom environment never loads the SQLite WASM. Every
// step is best-effort: if PowerSync can't init/connect, the kiosk simply keeps
// reading over REST (just without the live auto-refresh). onTablesChange lets the
// data hooks refetch the instant replicated rows change.
//
// The engine is supervised: a SyncHealthMonitor watches the status stream and,
// when the engine wedges (online + signed in but no connected/synced state for a
// sustained window — see the 2026-07-20 incident where the client silently
// stopped opening sync streams and rendered an empty replica), restarts it:
// soft (disconnect/connect) first, then hard (rebuild the client). A hard
// restart replaces the db instance, so long-lived watches subscribe to
// onPowerSyncRecreated to re-arm on the new one.
import { PowerSyncDatabase } from '@powersync/web'
import type { SyncStatus } from '@powersync/web'
import { AppSchema } from './schema'
import { WaffledConnector } from './connector'
import { getAccessToken } from '../api/client'
import { SyncHealthMonitor } from './sync-health'

let db: PowerSyncDatabase | null = null
let unlistenStatus: (() => void) | null = null
const recreateSubs = new Set<() => void>()

const monitor = new SyncHealthMonitor({
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
  isAuthenticated: () => !!getAccessToken(),
  softRestart: () => restartPowerSyncSoft(),
  hardRestart: () => restartPowerSyncHard(),
})

export function getPowerSyncDb(): PowerSyncDatabase | null {
  return db
}

// Build + connect a client and wire its status stream into the health store.
async function startClient(): Promise<void> {
  const instance = new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: 'waffled.db' },
  })
  await instance.init()
  db = instance
  unlistenStatus = instance.registerListener({
    statusChanged: (s: SyncStatus) =>
      monitor.noteStatus({
        connected: s.connected,
        connecting: s.connecting,
        hasSynced: s.hasSynced,
        lastSyncedAt: s.lastSyncedAt ? s.lastSyncedAt.getTime() : null,
      }),
  })
  // connect() retries internally; fetchCredentials returning null just means
  // "not signed in yet" — it'll connect once a token is available.
  await instance.connect(new WaffledConnector())
  monitor.engineStarted()
  monitor.start()
}

// Stand up the local DB and start streaming this household's rows. Safe to call
// more than once; only the first call does work. Never throws.
export async function connectPowerSync(): Promise<void> {
  if (db) return
  try {
    await startClient()
  } catch (err) {
    console.warn('PowerSync unavailable; falling back to REST only', err)
    db = null
  }
}

// Cheap engine kick: drop the sync connection and dial again on the same client.
// First rung of the watchdog ladder. Never throws; a no-op without a client.
export async function restartPowerSyncSoft(): Promise<void> {
  const instance = db
  if (!instance) return
  try {
    await instance.disconnect()
    await instance.connect(new WaffledConnector())
  } catch (err) {
    console.warn('PowerSync soft restart failed', err)
  }
}

// Full rebuild: close the (possibly wedged) client and create a fresh one —
// also what the Settings "Restart sync" button calls. Concurrent calls share
// one restart. Never throws.
let hardRestarting: Promise<void> | null = null
export function restartPowerSyncHard(): Promise<void> {
  if (!hardRestarting) {
    hardRestarting = doHardRestart().finally(() => {
      hardRestarting = null
    })
  }
  return hardRestarting
}

async function doHardRestart(): Promise<void> {
  const old = db
  db = null
  unlistenStatus?.()
  unlistenStatus = null
  if (old) {
    try {
      await old.close()
    } catch {
      /* a wedged client may refuse to close cleanly — replace it anyway */
    }
  }
  try {
    await startClient()
    // Long-lived watches hang off the dead client — tell them to re-arm.
    for (const cb of [...recreateSubs]) cb()
  } catch (err) {
    console.warn('PowerSync restart failed; falling back to REST only', err)
    db = null
    monitor.engineStopped()
  }
}

// Fires after a hard restart replaced the client. Subscribers re-arm their
// watches/listeners against getPowerSyncDb()'s new instance.
export function onPowerSyncRecreated(cb: () => void): () => void {
  recreateSubs.add(cb)
  return () => recreateSubs.delete(cb)
}

// Subscribe to changes on the given tables; returns a disposer. A no-op (with a
// no-op disposer) when PowerSync isn't running, so callers need no guards.
// Survives a hard restart by re-registering on the replacement client.
export function onTablesChange(tables: string[], cb: () => void): () => void {
  let disposeInner: () => void = () => {}
  const arm = () => {
    disposeInner = () => {}
    if (!db) return
    try {
      disposeInner = db.onChange(
        {
          onChange: () => {
            cb()
          },
        },
        { tables }
      )
    } catch {
      /* keep the no-op disposer */
    }
  }
  arm()
  const offRecreate = onPowerSyncRecreated(arm)
  return () => {
    offRecreate()
    disposeInner()
  }
}
