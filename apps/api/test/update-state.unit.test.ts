// Liveness/stuck derivation for the in-app update button. Pure function over
// timestamps — no DB, no clock: `now` is injected so these never flake.
import { describe, it, expect } from 'vitest'
import { derive, AGENT_STALE_MS, STUCK_MS, type UpdateStateRow } from '../src/modules/updates/update-state'

const NOW = Date.parse('2026-08-26T12:00:00Z')
const base: UpdateStateRow = {
  status: 'idle',
  requestedAt: null,
  claimedAt: null,
  finishedAt: null,
  exitCode: null,
  message: null,
  agentSeenAt: new Date(NOW - 1000).toISOString(),
  behindCount: 0,
}

describe('derive', () => {
  it('reports a live agent as up', () => {
    expect(derive(base, NOW).agentDown).toBe(false)
  })

  it('reports a never-seen agent as down', () => {
    expect(derive({ ...base, agentSeenAt: null }, NOW).agentDown).toBe(true)
  })

  it('reports a silent agent as down past the stale window', () => {
    const old = new Date(NOW - AGENT_STALE_MS - 1000).toISOString()
    expect(derive({ ...base, agentSeenAt: old }, NOW).agentDown).toBe(true)
  })

  it('is not stuck while running inside the window', () => {
    const row: UpdateStateRow = { ...base, status: 'running', claimedAt: new Date(NOW - 60_000).toISOString() }
    expect(derive(row, NOW).stuck).toBe(false)
  })

  it('is stuck once running past the limit', () => {
    const row: UpdateStateRow = { ...base, status: 'running', claimedAt: new Date(NOW - STUCK_MS - 1000).toISOString() }
    expect(derive(row, NOW).stuck).toBe(true)
  })

  it('is never stuck when not running', () => {
    const row: UpdateStateRow = { ...base, status: 'queued', claimedAt: new Date(NOW - STUCK_MS - 1000).toISOString() }
    expect(derive(row, NOW).stuck).toBe(false)
  })
})
