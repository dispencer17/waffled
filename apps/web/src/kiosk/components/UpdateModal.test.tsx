import { render, screen, waitFor } from '@testing-library/react'
import { UpdateModal } from './UpdateModal'

const ok = (b: unknown) => ({ ok: true, json: async () => b })
const adminPerson = { id: 'p1', name: 'Kevin', memberType: 'adult', isAdmin: true, avatarEmoji: '🐻', colorHex: '#333', capabilities: [] }
const kidPerson = { ...adminPerson, id: 'p2', name: 'Wally', memberType: 'kid', isAdmin: false }
const household = { id: 'h', name: 'Home', timezone: 'UTC', weekStart: 'sunday' }
const updatesBody = (updateAvailable: boolean) => ({
  enabled: true,
  current: { version: '0.2.3', sha: 'abc' },
  latest: { tag: 'v0.2.4', url: 'https://github.com/kevinpsites/waffled/releases/tag/v0.2.4', publishedAt: null },
  updateAvailable,
})

function mockApi(opts: { admin: boolean; updateAvailable?: boolean }): string[] {
  const calls: string[] = []
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    calls.push(u)
    if (u.includes('/api/household')) return ok({ provisioned: true, household, person: opts.admin ? adminPerson : kidPerson })
    if (u.includes('/api/updates')) return ok(updatesBody(opts.updateAvailable ?? true))
    return ok({})
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('UpdateModal', () => {
  it('shows an admin the update, with changelog + upgrade links', async () => {
    mockApi({ admin: true, updateAvailable: true })
    render(<UpdateModal />)
    expect(await screen.findByText(/Waffled 0\.2\.4 is here/i)).toBeInTheDocument()
    expect(screen.getByText('./waffled upgrade')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view changelog/i }).getAttribute('href')).toContain('/releases/tag/v0.2.4')
    expect(screen.getByRole('link', { name: /how to upgrade/i }).getAttribute('href')).toContain('docs.waffled.app/operations/upgrading')
  })

  it('fork build: names the fork version, drops the upgrade command for merge-upstream guidance', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/household')) return ok({ provisioned: true, household, person: adminPerson })
      if (u.includes('/api/updates')) return ok({
        enabled: true,
        current: { version: '0.8.0', sha: '44b55ccd', fork: 'v0.8.0-153-g44b55ccd' },
        latest: { tag: 'v0.9.0', url: 'https://github.com/kevinpsites/waffled/releases/tag/v0.9.0', publishedAt: null },
        updateAvailable: true,
      })
      return ok({})
    }) as unknown as typeof fetch
    render(<UpdateModal />)
    expect(await screen.findByText(/Waffled 0\.9\.0 is here/i)).toBeInTheDocument()
    expect(screen.getByText(/You.re on v0\.8\.0-153-g44b55ccd \(upstream base 0\.8\.0\)/)).toBeInTheDocument()
    // The one-command upgrade would install upstream's images over the fork — never show it.
    expect(screen.queryByText('./waffled upgrade')).not.toBeInTheDocument()
    expect(screen.getByText(/merging upstream/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /how to upgrade/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view changelog/i }).getAttribute('href')).toContain('/releases/tag/v0.9.0')
  })

  it('stays hidden when already up to date', async () => {
    const calls = mockApi({ admin: true, updateAvailable: false })
    render(<UpdateModal />)
    await waitFor(() => expect(calls.some((u) => u.includes('/api/updates'))).toBe(true))
    expect(screen.queryByText(/is here/i)).not.toBeInTheDocument()
  })

  it('stays hidden once that version was dismissed', async () => {
    localStorage.setItem('waffled.update.dismissed', 'v0.2.4')
    const calls = mockApi({ admin: true, updateAvailable: true })
    render(<UpdateModal />)
    await waitFor(() => expect(calls.some((u) => u.includes('/api/updates'))).toBe(true))
    expect(screen.queryByText(/is here/i)).not.toBeInTheDocument()
  })

  it('never asks the update endpoint for a non-admin', async () => {
    const calls = mockApi({ admin: false, updateAvailable: true })
    render(<UpdateModal />)
    await waitFor(() => expect(calls.some((u) => u.includes('/api/household'))).toBe(true))
    await new Promise((r) => setTimeout(r, 10)) // let any (unwanted) follow-up fire
    expect(calls.some((u) => u.includes('/api/updates'))).toBe(false)
    expect(screen.queryByText(/is here/i)).not.toBeInTheDocument()
  })
})

// ── Deploy prompt (fork) ──────────────────────────────────────────────────────
// A second reason to open: commits are on the fork's main but not deployed. This
// one is actionable in-app (the Update button) rather than a "go run a command".
describe('UpdateModal — fork deploy prompt', () => {
  const deployBody = (update: Record<string, unknown>) => ({
    enabled: true,
    current: { version: '0.8.0', sha: 'abc', fork: 'v0.8.0-12-gabc' },
    latest: null,
    updateAvailable: false,
    update: { status: 'idle', behindCount: 0, message: null, agentDown: false, stuck: false, ...update },
  })

  function mockDeploy(update: Record<string, unknown>) {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/household')) return ok({ provisioned: true, household, person: adminPerson })
      if (u.includes('/api/updates')) return ok(deployBody(update))
      return ok({})
    }) as unknown as typeof fetch
  }

  it('offers to deploy waiting fork commits', async () => {
    mockDeploy({ behindCount: 4 })
    render(<UpdateModal />)
    expect(await screen.findByText(/4 new commits ready to deploy/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /update now/i })).toBeInTheDocument()
  })

  it('stays shut when nothing is waiting', async () => {
    mockDeploy({ behindCount: 0 })
    render(<UpdateModal />)
    await waitFor(() => expect(screen.queryByText(/ready to deploy/i)).not.toBeInTheDocument())
  })

  it('does not re-nag at the same commit count once dismissed', async () => {
    localStorage.setItem('waffled.update.deployDismissed', '4')
    mockDeploy({ behindCount: 4 })
    render(<UpdateModal />)
    await waitFor(() => expect(screen.queryByText(/ready to deploy/i)).not.toBeInTheDocument())
  })

  it('re-nags once more commits land', async () => {
    localStorage.setItem('waffled.update.deployDismissed', '4')
    mockDeploy({ behindCount: 6 })
    render(<UpdateModal />)
    expect(await screen.findByText(/6 new commits ready to deploy/i)).toBeInTheDocument()
  })

  it('surfaces a failed update so an overnight failure is noticed', async () => {
    mockDeploy({ status: 'failed', message: 'Working tree has uncommitted changes' })
    render(<UpdateModal />)
    expect(await screen.findByText(/update failed/i)).toBeInTheDocument()
    expect(screen.getByText(/uncommitted changes/i)).toBeInTheDocument()
  })

  it('does not nag the family about operator-only conditions', async () => {
    mockDeploy({ agentDown: true, stuck: true })
    render(<UpdateModal />)
    await waitFor(() => expect(screen.queryByText(/ready to deploy/i)).not.toBeInTheDocument())
    expect(screen.queryByText(/isn't responding/i)).not.toBeInTheDocument()
  })
})
