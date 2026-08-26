// Server-wide state for the in-app update button (fork). The API runs in a
// container with no docker socket and no git, so it cannot rebuild its own host
// and cannot see whether origin/main is ahead. The request direction is therefore
// inverted: this table is a mailbox that the button writes to and a host
// scheduled task ("Waffled Fork Update Agent") polls, claims, and reports back on.
// See docs/superpowers/specs/2026-08-26-update-button-design.md
import { query } from '../../platform/db'

export type UpdateStatus = 'idle' | 'queued' | 'running' | 'failed'

export interface UpdateStateRow {
  status: UpdateStatus
  requestedAt: string | null
  claimedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  message: string | null
  agentSeenAt: string | null
  behindCount: number
}

export interface DerivedUpdate extends UpdateStateRow {
  agentDown: boolean
  stuck: boolean
}

/** No agent contact within this window → the host task isn't running. */
export const AGENT_STALE_MS = 10 * 60_000
/** Claimed but still not finished after this → the rebuild wedged. */
export const STUCK_MS = 30 * 60_000

// Derived, never stored: a stored "agent is down" flag would need a writer that
// is itself the thing that's down.
export function derive(row: UpdateStateRow, now: number): DerivedUpdate {
  const seen = row.agentSeenAt ? Date.parse(row.agentSeenAt) : null
  const claimed = row.claimedAt ? Date.parse(row.claimedAt) : null
  return {
    ...row,
    agentDown: seen === null || now - seen > AGENT_STALE_MS,
    stuck: row.status === 'running' && claimed !== null && now - claimed > STUCK_MS,
  }
}

interface DbRow {
  status: UpdateStatus
  requested_at: Date | null
  claimed_at: Date | null
  finished_at: Date | null
  exit_code: number | null
  message: string | null
  agent_seen_at: Date | null
  behind_count: number
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

function toRow(r: DbRow): UpdateStateRow {
  return {
    status: r.status,
    requestedAt: iso(r.requested_at),
    claimedAt: iso(r.claimed_at),
    finishedAt: iso(r.finished_at),
    exitCode: r.exit_code,
    message: r.message,
    agentSeenAt: iso(r.agent_seen_at),
    behindCount: r.behind_count,
  }
}

const COLS = 'status, requested_at, claimed_at, finished_at, exit_code, message, agent_seen_at, behind_count'
const COLS_U = COLS.split(', ')
  .map((c) => `u.${c}`)
  .join(', ')

export async function readState(): Promise<UpdateStateRow> {
  const { rows } = await query<DbRow>(`select ${COLS} from update_state where id = true`)
  return toRow(rows[0])
}

// Idempotent by construction: the WHERE clause matches nothing when a run is
// already queued or in flight, so a double-press cannot queue twice.
export async function requestUpdate(personId: string): Promise<UpdateStateRow> {
  await query(
    `update update_state
        set status = 'queued', requested_at = now(), requested_by = $1,
            claimed_at = null, finished_at = null, exit_code = null, message = null
      where id = true and status in ('idle', 'failed')`,
    [personId]
  )
  return readState()
}

// One statement, one row lock: `for update` in the CTE serializes concurrent
// pollers, and comparing against the PREVIOUS status is what makes the claim
// exactly-once when a slow rebuild overlaps the next poll.
export async function agentPoll(
  behind: number,
  result?: { exitCode: number; message: string }
): Promise<{ state: UpdateStateRow; pending: boolean }> {
  if (result) {
    const { rows } = await query<DbRow>(
      `update update_state
          set agent_seen_at = now(), behind_count = $1,
              status = case when $2 = 0 then 'idle' else 'failed' end,
              finished_at = now(), exit_code = $2, message = $3
        where id = true
        returning ${COLS}`,
      [behind, result.exitCode, result.message]
    )
    return { state: toRow(rows[0]), pending: false }
  }
  const { rows } = await query<DbRow & { prev_status: UpdateStatus }>(
    `with prev as (select status from update_state where id = true for update)
     update update_state u
        set agent_seen_at = now(), behind_count = $1,
            status = case when prev.status = 'queued' then 'running' else u.status end,
            claimed_at = case when prev.status = 'queued' then now() else u.claimed_at end
       from prev
      where u.id = true
      returning prev.status as prev_status, ${COLS_U}`,
    [behind]
  )
  return { state: toRow(rows[0]), pending: rows[0].prev_status === 'queued' }
}
