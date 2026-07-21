// Sync-engine health: watchdog + tiny status store. PowerSync can wedge silently
// (incident 2026-07-20: the web client stopped opening sync streams after a large
// server-side delete batch — no error, no reconnect, empty replica rendered as an
// empty calendar). This module (a) tracks the engine's status stream, (b) flags a
// stall — online + signed in but not connected+synced for a sustained window —
// (c) auto-restarts the engine (soft disconnect/connect, then a hard client
// rebuild, with doubling backoff), and (d) tells readers whether the local
// replica can be trusted, so the UI falls back to REST instead of rendering an
// empty-but-wedged replica. Deliberately db-agnostic: db.ts injects the real
// restart hooks; everything here is plain testable logic.
import { useSyncExternalStore } from 'react'

// 'starting' = engine boot in progress (WASM/OPFS init takes a few seconds — the
// 2026-07-21 report was a user reading the boot window as "off"). 'failed' = the
// boot (or a hard restart) threw; the error rides along in lastError so the card
// can say WHY instead of a crash masquerading as "off".
export type SyncHealthStatus = 'off' | 'starting' | 'failed' | 'no-auth' | 'offline' | 'connecting' | 'ok' | 'stalled'

export interface SyncHealthSnapshot {
  status: SyncHealthStatus
  // Whether the engine ever completed a full sync (null = unknown / no engine).
  hasSynced: boolean | null
  lastSyncedAt: number | null // ms epoch of the last completed sync
  restartCount: number // watchdog restarts this session (surfaced in System Health)
  lastRestartAt: number | null
  lastError?: string | null // set only while status is 'failed'
}

// Stall = not connected+synced for this long while online and signed in. Long
// enough that token refreshes and flaky-network reconnects never trip it; short
// enough that a family glancing at the kiosk rarely sees stale data for long.
export const STALL_AFTER_MS = 3 * 60_000
// Watchdog cadence. Cheap (pure bookkeeping), so it can be frequent.
export const HEALTH_TICK_MS = 30_000
// Restart pacing: first retry after the stall fires, then 2m, 4m, 8m… capped —
// a persistent outage self-heals when service returns without hammering it.
export const RESTART_BACKOFF_BASE_MS = 2 * 60_000
export const RESTART_BACKOFF_MAX_MS = 16 * 60_000

const OFF: SyncHealthSnapshot = { status: 'off', hasSynced: null, lastSyncedAt: null, restartCount: 0, lastRestartAt: null }

// ── store ─────────────────────────────────────────────────────────────────────
let snapshot: SyncHealthSnapshot = OFF
const subscribers = new Set<() => void>()

export function getSyncHealth(): SyncHealthSnapshot {
  return snapshot
}

// useSyncExternalStore-compatible: cb takes no args; read via getSyncHealth.
export function subscribeSyncHealth(cb: () => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

export function publishSyncHealth(next: SyncHealthSnapshot): void {
  const prev = snapshot
  if (
    prev.status === next.status &&
    prev.hasSynced === next.hasSynced &&
    prev.lastSyncedAt === next.lastSyncedAt &&
    prev.restartCount === next.restartCount &&
    prev.lastRestartAt === next.lastRestartAt &&
    (prev.lastError ?? null) === (next.lastError ?? null)
  )
    return
  snapshot = next
  for (const cb of [...subscribers]) cb()
}

// Can offline-first reads treat the local replica as the source of truth? Only
// when it holds a complete sync AND the engine isn't wedged. When false, the
// data hooks let REST drive so a stalled/empty replica never blanks the UI.
export function isReplicaTrusted(): boolean {
  return (
    snapshot.hasSynced === true &&
    snapshot.status !== 'stalled' &&
    snapshot.status !== 'off' &&
    snapshot.status !== 'starting' &&
    snapshot.status !== 'failed'
  )
}

export function useSyncHealth(): SyncHealthSnapshot {
  return useSyncExternalStore(subscribeSyncHealth, getSyncHealth, getSyncHealth)
}

export function __resetSyncHealthForTests(): void {
  snapshot = OFF
  subscribers.clear()
}

// ── watchdog ──────────────────────────────────────────────────────────────────
export interface EngineStatus {
  connected: boolean
  connecting: boolean
  hasSynced: boolean | undefined
  lastSyncedAt: number | null
}

export interface SyncHealthMonitorDeps {
  isOnline(): boolean
  isAuthenticated(): boolean
  softRestart(): Promise<void> // disconnect + reconnect the existing client
  hardRestart(): Promise<void> // tear down and rebuild the client/worker
  now?(): number
}

export class SyncHealthMonitor {
  private deps: Required<Pick<SyncHealthMonitorDeps, 'isOnline' | 'isAuthenticated' | 'softRestart' | 'hardRestart'>> & {
    now(): number
  }
  // Engine lifecycle: 'off' (never attempted / stopped) → 'starting' (boot in
  // progress) → 'running' (connectPowerSync succeeded) or 'failed' (boot threw).
  private phase: 'off' | 'starting' | 'running' | 'failed' = 'off'
  private lastError: string | null = null
  private status: EngineStatus = { connected: false, connecting: false, hasSynced: undefined, lastSyncedAt: null }
  // Last instant the engine was verifiably healthy (connected + synced) — or,
  // while it can't possibly be (offline / signed out / just started), the moment
  // we last knew that. The stall window is measured from here.
  private lastHealthyAt = 0
  private attempts = 0 // restart ladder position; resets on recovery
  private restartCount = 0
  private lastRestartAt: number | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(deps: SyncHealthMonitorDeps) {
    this.deps = { now: () => Date.now(), ...deps }
  }

  engineStarting(): void {
    this.phase = 'starting'
    this.publish()
  }

  engineStarted(): void {
    this.phase = 'running'
    this.lastError = null
    this.lastHealthyAt = this.deps.now() // fresh grace window; ladder position intentionally kept
    this.publish()
  }

  engineFailed(err: unknown): void {
    this.phase = 'failed'
    this.lastError = err instanceof Error ? err.message : String(err)
    this.status = { connected: false, connecting: false, hasSynced: undefined, lastSyncedAt: null }
    this.publish()
  }

  engineStopped(): void {
    this.phase = 'off'
    this.status = { connected: false, connecting: false, hasSynced: undefined, lastSyncedAt: null }
    this.publish()
  }

  noteStatus(s: EngineStatus): void {
    this.status = s
    if (s.connected && s.hasSynced) {
      this.lastHealthyAt = this.deps.now()
      this.attempts = 0 // recovered — next stall starts the ladder from soft again
    }
    this.publish()
  }

  // One watchdog pass: classify, and when stalled, run the restart ladder.
  // Restarts happen only here (never from status events) so a flood of engine
  // events can't trigger a restart storm.
  async tick(): Promise<void> {
    const now = this.deps.now()
    if (this.phase !== 'running') {
      this.publish()
      return
    }
    // While sync is impossible, keep the grace window pinned so a long offline
    // (or signed-out) stretch doesn't read as a stall the moment it ends.
    if (!this.deps.isOnline() || !this.deps.isAuthenticated()) {
      this.lastHealthyAt = now
      this.publish()
      return
    }
    if (this.classify(now) === 'stalled') await this.maybeRestart(now)
    this.publish()
  }

  start(tickMs: number = HEALTH_TICK_MS): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), tickMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private classify(now: number): SyncHealthStatus {
    if (this.phase === 'failed') return 'failed'
    if (this.phase === 'starting') return 'starting'
    if (this.phase !== 'running') return 'off'
    if (!this.deps.isOnline()) return 'offline'
    if (!this.deps.isAuthenticated()) return 'no-auth'
    if (this.status.connected && this.status.hasSynced) return 'ok'
    // Not verifiably healthy: connected-but-never-synced counts too (a wedged
    // bootstrap looks exactly like the incident: connected, replica empty).
    return now - this.lastHealthyAt > STALL_AFTER_MS ? 'stalled' : 'connecting'
  }

  private async maybeRestart(now: number): Promise<void> {
    if (this.attempts > 0) {
      const backoff = Math.min(RESTART_BACKOFF_BASE_MS * 2 ** (this.attempts - 1), RESTART_BACKOFF_MAX_MS)
      if (this.lastRestartAt !== null && now - this.lastRestartAt < backoff) return
    }
    const hard = this.attempts >= 1 // soft first; escalate when it didn't take
    this.attempts++
    this.restartCount++
    this.lastRestartAt = now
    try {
      await (hard ? this.deps.hardRestart() : this.deps.softRestart())
    } catch {
      /* restart itself failed — the backoff paces the next try */
    }
  }

  private publish(): void {
    publishSyncHealth({
      status: this.classify(this.deps.now()),
      hasSynced: this.status.hasSynced ?? null,
      lastSyncedAt: this.status.lastSyncedAt,
      restartCount: this.restartCount,
      lastRestartAt: this.lastRestartAt,
      lastError: this.phase === 'failed' ? this.lastError : null,
    })
  }
}
