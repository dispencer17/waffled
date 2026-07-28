import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Settings } from './Settings'
import type { PermissionMatrix } from '../lib/api'
import { publishSyncHealth, __resetSyncHealthForTests } from '../lib/powersync/sync-health'

// The System Health panel's Live Sync card talks to the PowerSync client —
// stub the db module (jsdom never runs the real engine anyway).
const restartHardMock = vi.hoisted(() => vi.fn(async () => {}))
// The AI & Capture wake-word card drives the real mic/engines — stub the lib.
const testWakeWordMock = vi.hoisted(() => vi.fn<() => Promise<'detected' | 'timeout'>>(async () => 'detected'))
vi.mock('../lib/voice/wakeword', () => ({
  testWakeWord: testWakeWordMock,
  frameRms: () => 0,
  startWakeWord: vi.fn(async () => true),
  stopWakeWord: vi.fn(async () => {}),
  wakeWordRunning: () => false,
  BUILTIN_KEYWORDS: ['Computer', 'Jarvis'],
}))
vi.mock('../lib/powersync/db', () => ({
  getPowerSyncDb: () => null,
  connectPowerSync: async () => {},
  onPowerSyncRecreated: () => () => {},
  onTablesChange: () => () => {},
  restartPowerSyncSoft: vi.fn(async () => {}),
  restartPowerSyncHard: restartHardMock,
}))

afterEach(() => __resetSyncHealthForTests())

const renderSettings = () => render(<MemoryRouter><Settings /></MemoryRouter>)

const displayConfig = {
  screensaverMinutes: 15,
  content: 'photos',
  returnToPicker: true,
  resetHomeMinutes: 3,
  nightDim: { enabled: false, start: '22:00', end: '07:00' },
  photoSource: 'all',
  photoAlbum: null,
  photoInterval: 10,
  photoShuffle: false,
}
const samplePhotos = [
  { id: 'ph1', imageUrl: null, caption: 'a', emoji: '🏖️', colorHex: '#7fc1e8', memory: 'Lake Day', takenAt: null, isFavorite: true, reactions: {}, uploadedBy: null, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'ph2', imageUrl: null, caption: 'b', emoji: '🎂', colorHex: '#7fc1e8', memory: 'Birthday', takenAt: null, isFavorite: false, reactions: {}, uploadedBy: null, createdAt: '2026-01-02T00:00:00Z' },
]

const household = { id: 'h1', name: 'The Family', timezone: 'America/Chicago', weekStart: 'sunday', ownerPersonId: 'p1' }
const members = [
  { id: 'p1', name: 'Kevin', memberType: 'adult', isAdmin: true, avatarEmoji: '🐻', colorHex: '#2F7FED', birthday: null, showOnKiosk: true, hasLogin: true, isOwner: true },
  { id: 'p2', name: 'Wally', memberType: 'kid', isAdmin: false, avatarEmoji: '🐢', colorHex: '#25A368', birthday: '2018-05-01', showOnKiosk: true, hasLogin: false, isOwner: false },
]

function mockApi() {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
    // useHousehold() drives the admin gate — return the owner (an admin).
    if (String(url).includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
    if (String(url).includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

describe('Settings screen', () => {
  it('offers a compact section menu for narrow layouts', async () => {
    mockApi()
    renderSettings()
    await screen.findByText('Kevin')

    const menu = screen.getByLabelText('Settings section')
    expect(menu).toHaveClass('sel')
    // Fork: Appearance is folded into Display & Kiosk (theme is per-device, so that
    // tab is not admin-gated) — upstream's standalone 'appearance' tab is gone.
    fireEvent.change(menu, { target: { value: 'display' } })
    expect(screen.getByText('Match system')).toBeInTheDocument()
  })

  it('renders the sub-nav and Family & people with member role lines', async () => {
    mockApi()
    renderSettings()

    expect(await screen.findByText('Family & People')).toBeInTheDocument() // nav item
    expect(await screen.findByText('Kevin')).toBeInTheDocument()
    expect(screen.getByText(/Adult · Owner · signed in/)).toBeInTheDocument()
    expect(screen.getByText('Wally')).toBeInTheDocument()
    expect(screen.getByText(/Kid · age \d+ · managed by parents/)).toBeInTheDocument()

    // household settings
    expect(screen.getByText('Household name')).toBeInTheDocument()
    expect(screen.getByText('Week starts on')).toBeInTheDocument()
  })

  it('opens the Add-a-person modal', async () => {
    mockApi()
    renderSettings()
    fireEvent.click(await screen.findByText(/Add a person/))
    expect(document.querySelector('.modal-card')).toBeTruthy()
    expect(screen.getByText('Add a person', { selector: '.wf-serif' })).toBeInTheDocument()
  })

  it('hides settings destinations that do not have working controls', async () => {
    mockApi()
    renderSettings()
    await screen.findByText('Kevin')
    expect(screen.queryByText('Lists')).not.toBeInTheDocument()
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument()
  })

  it('shows the Display & Kiosk panel with the family-display toggle', async () => {
    mockApi()
    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('Display & Kiosk'))
    expect(await screen.findByText('Use this browser as the family display')).toBeInTheDocument()
  })

  it('saves screensaver photo-source / interval / shuffle changes', async () => {
    const puts: Array<Record<string, unknown>> = []
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/kiosk/display')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          puts.push(body)
          return { ok: true, json: async () => body }
        }
        return { ok: true, json: async () => displayConfig }
      }
      if (u.includes('/api/photos')) return { ok: true, json: async () => ({ photos: samplePhotos }) }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      if (u.includes('/api/events')) return { ok: true, json: async () => ({ events: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('Display & Kiosk'))

    // The new photo-playback controls render under the Screensaver subheading.
    expect(await screen.findByText('Photo source')).toBeInTheDocument()
    expect(screen.getByText('Transition speed')).toBeInTheDocument()
    expect(screen.getByText('Shuffle photos')).toBeInTheDocument()

    // Favorites-only source → PUT carries photoSource: 'favorites'.
    fireEvent.click(screen.getByText('Favorites only'))
    await waitFor(() => expect(puts.some((p) => p.photoSource === 'favorites')).toBe(true))

    // Transition speed select → PUT carries the new photoInterval.
    const speed = screen.getByDisplayValue('10 seconds') as HTMLSelectElement
    fireEvent.change(speed, { target: { value: '30' } })
    await waitFor(() => expect(puts.some((p) => p.photoInterval === 30)).toBe(true))
  })

  it('renders the permissions grid with a Manage goals column and toggles it', async () => {
    const puts: PermissionMatrix[] = []
    const emptyRow = { 'chore.manage': false, 'chore.approve': false, 'reward.manage': false, 'reward.approve': false, 'reward.grant': false, 'goal.manage': false }
    const matrix: PermissionMatrix = { adult: { ...emptyRow }, teen: { ...emptyRow }, kid: { ...emptyRow } }
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/permissions')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { permissions: PermissionMatrix }
          puts.push(body.permissions)
          return { ok: true, json: async () => ({ permissions: body.permissions }) }
        }
        return { ok: true, json: async () => ({ permissions: matrix }) }
      }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderSettings()
    await screen.findByText('Kevin')

    // The grid renders dynamically from CAPABILITIES — the new goal.manage column
    // shows as a "Manage goals" header.
    expect(await screen.findByText('Manage goals')).toBeInTheDocument()
    // Toggling Teen's Manage goals checkbox PUTs the matrix with it flipped on.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Teen: Manage goals' }))
    await waitFor(() => expect(puts.some((m) => m.teen['goal.manage'] === true)).toBe(true))
  })

  it('plumbs the Countdowns config (sleeps toggle + birthday horizon) under Calendars', async () => {
    const puts: Array<Record<string, unknown>> = []
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/countdowns/config')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        puts.push(body)
        return { ok: true, json: async () => body }
      }
      if (u.includes('/api/countdowns')) return { ok: true, json: async () => ({ countdowns: [], sleeps: false, birthdayHorizonDays: 183 }) }
      if (u.includes('/api/calendar/google/status')) return { ok: true, json: async () => ({ configured: false, connected: false, accounts: [], calendars: [] }) }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('Calendars'))

    // Sleeps pill flips → PUT { sleeps: true }.
    fireEvent.click(await screen.findByText(/Count in .sleeps. instead of .days./))
    await waitFor(() => expect(puts.some((p) => p.sleeps === true)).toBe(true))

    // Birthday-horizon select → PUT { birthdayHorizonDays: <choice> }.
    const horizon = screen.getByLabelText('Show birthdays within') as HTMLSelectElement
    fireEvent.change(horizon, { target: { value: '92' } })
    await waitFor(() => expect(puts.some((p) => p.birthdayHorizonDays === 92)).toBe(true))
  })

  it('Calendars: lists ICS calendar feeds (with error badge) and adds a new one', async () => {
    const posts: Array<{ url: string; body: Record<string, unknown> }> = []
    const feeds = [
      { id: 'f1', url: 'https://school.example/cal.ics', name: 'School calendar', personId: null, personName: null, personColor: null, visibility: 'family', lastSyncedAt: '2026-07-01T00:00:00Z', lastError: null, createdAt: '2026-06-01T00:00:00Z' },
      { id: 'f2', url: 'https://broken.example/x.ics', name: null, personId: null, personName: null, personColor: null, visibility: 'family', lastSyncedAt: null, lastError: 'feed returned HTTP 404', createdAt: '2026-06-02T00:00:00Z' },
    ]
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/calendar/feeds')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
          posts.push({ url: u, body })
          if (u.endsWith('/sync')) return { ok: true, json: async () => ({ feedId: 'f3', name: null, imported: 2, updated: 0, deleted: 0 }) }
          return { ok: true, json: async () => ({ feed: { ...feeds[0], id: 'f3', url: body.url as string, name: (body.name as string) ?? null } }) }
        }
        return { ok: true, json: async () => ({ feeds }) }
      }
      if (u.includes('/api/calendar/google/status')) return { ok: true, json: async () => ({ configured: false, connected: false, accounts: [], calendars: [], feeds }) }
      if (u.includes('/api/countdowns')) return { ok: true, json: async () => ({ countdowns: [], sleeps: false, birthdayHorizonDays: 183 }) }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('Calendars'))

    // The feeds card renders even with no OAuth provider configured — that
    // independence is the point of ICS subscriptions.
    expect(await screen.findByText(/Calendar feeds/)).toBeInTheDocument()
    expect(screen.getByText('School calendar')).toBeInTheDocument()
    // The nameless feed falls back to its host; the broken one shows its error.
    expect(screen.getAllByText(/broken\.example/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/feed returned HTTP 404/)).toBeInTheDocument()

    // Add row: URL + optional name → POST, then an immediate first sync.
    fireEvent.change(screen.getByPlaceholderText('https://…/calendar.ics'), { target: { value: 'https://team.example/cal.ics' } })
    fireEvent.change(screen.getByPlaceholderText('School calendar'), { target: { value: 'Soccer' } })
    fireEvent.click(screen.getByText('Add feed'))
    await waitFor(() =>
      expect(posts.some((p) => !p.url.endsWith('/sync') && p.body.url === 'https://team.example/cal.ics' && p.body.name === 'Soccer')).toBe(true)
    )
    await waitFor(() => expect(posts.some((p) => p.url.includes('/f3/sync'))).toBe(true))
  })

  it('Calendars: feed rows expose a Private toggle and a manual Sync now', async () => {
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = []
    const feeds = [
      { id: 'f1', url: 'https://school.example/cal.ics', name: 'School calendar', personId: null, personName: null, personColor: null, visibility: 'family', lastSyncedAt: '2026-07-01T00:00:00Z', lastError: null, createdAt: '2026-06-01T00:00:00Z' },
    ]
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/calendar/feeds')) {
        const method = init?.method ?? 'GET'
        if (method !== 'GET') {
          calls.push({ url: u, method, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
          if (u.endsWith('/sync')) return { ok: true, json: async () => ({ feedId: 'f1', name: 'School calendar', imported: 0, updated: 0, deleted: 0 }) }
          return { ok: true, json: async () => ({ feed: { ...feeds[0], visibility: 'personal' } }) }
        }
        return { ok: true, json: async () => ({ feeds }) }
      }
      if (u.includes('/api/calendar/google/status')) return { ok: true, json: async () => ({ configured: false, connected: false, accounts: [], calendars: [], feeds }) }
      if (u.includes('/api/countdowns')) return { ok: true, json: async () => ({ countdowns: [], sleeps: false, birthdayHorizonDays: 183 }) }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('Calendars'))
    await screen.findByText('School calendar')

    // Private → PATCH visibility 'personal' (API supported this all along; the
    // control was the missing piece — see BACKLOG P9).
    fireEvent.click(screen.getByLabelText('Private feed School calendar'))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.includes('/f1') && c.body.visibility === 'personal')).toBe(true))

    // Manual refresh → POST /feeds/:id/sync.
    fireEvent.click(screen.getByLabelText('Sync feed School calendar'))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/f1/sync'))).toBe(true))
  })

  it('AI & Capture hosts the Wake word card: toggle saves, Test button walks listening → heard', async () => {
    const puts: Array<Record<string, unknown>> = []
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/kiosk/display')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
          puts.push(body)
          return { ok: true, json: async () => body }
        }
        return { ok: true, json: async () => ({ ...displayConfig, voice: { wakeWord: false, picovoiceKey: null, keyword: 'Computer' } }) }
      }
      if (u.includes('/api/voice/status')) return { ok: true, json: async () => ({ stt: 'local' }) }
      if (u.includes('/api/capture/config')) return { ok: true, json: async () => ({ provider: 'heuristic', model: null, available: { heuristic: true, anthropic: false, openai: false, ollama: false }, defaultModels: { anthropic: 'a', openai: 'o', ollama: 'l' } }) }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    let resolveTest!: (v: 'detected' | 'timeout') => void
    testWakeWordMock.mockImplementation(() => new Promise((r) => { resolveTest = r }))

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('AI & Capture'))

    // The card lives here now, with behavior copy beside the toggle.
    expect(await screen.findByText('Wake word')).toBeInTheDocument()
    expect(screen.getByText(/answers .Yes\?. and starts a voice command/)).toBeInTheDocument()

    // Toggle on → PUT /api/kiosk/display with voice.wakeWord true (debounced).
    fireEvent.click(screen.getByLabelText('Enable wake word'))
    await waitFor(() => {
      const v = puts.at(-1)?.voice as { wakeWord?: boolean } | undefined
      expect(v?.wakeWord).toBe(true)
    }, { timeout: 3000 })

    // Test button: listening state, then success on detection.
    fireEvent.click(screen.getByText(/Test wake word/))
    expect(await screen.findByText(/Listening — say/)).toBeInTheDocument()
    resolveTest('detected')
    expect(await screen.findByText(/Heard it!/)).toBeInTheDocument()
  })

  it('Wake word test reports a timeout and a mic error honestly', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/kiosk/display')) return { ok: true, json: async () => ({ ...displayConfig, voice: { wakeWord: true, picovoiceKey: null, keyword: 'Computer' } }) }
      if (u.includes('/api/voice/status')) return { ok: true, json: async () => ({ stt: 'local' }) }
      if (u.includes('/api/capture/config')) return { ok: true, json: async () => ({ provider: 'heuristic', model: null, available: { heuristic: true, anthropic: false, openai: false, ollama: false }, defaultModels: { anthropic: 'a', openai: 'o', ollama: 'l' } }) }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    testWakeWordMock.mockImplementationOnce(async () => 'timeout')
    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('AI & Capture'))
    fireEvent.click(await screen.findByText(/Test wake word/))
    expect(await screen.findByText(/Didn.t hear it/)).toBeInTheDocument()

    testWakeWordMock.mockImplementationOnce(async () => { throw new Error('Permission denied') })
    fireEvent.click(screen.getByText(/Test wake word/))
    expect(await screen.findByText(/Permission denied/)).toBeInTheDocument()
  })

  it('AI & Capture shows which voice transcription backend is active', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/voice/status')) return { ok: true, json: async () => ({ stt: 'local' }) }
      if (u.includes('/api/capture/config')) return { ok: true, json: async () => ({ provider: 'heuristic', model: null, available: { heuristic: true, anthropic: false, openai: false, ollama: false }, defaultModels: { anthropic: 'a', openai: 'o', ollama: 'l' } }) }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('AI & Capture'))
    expect(await screen.findByText(/Voice transcription/)).toBeInTheDocument()
    expect(screen.getByText('🖥 local Whisper')).toBeInTheDocument()
  })

  it('shows the System Health panel with component cards (admin)', async () => {
    const report = {
      status: 'degraded',
      version: { pkg: '0.0.0', sha: 'abc123', fork: 'v0.8.0-150-gabc1234', buildTime: null },
      generatedAt: '2026-06-25T20:00:00Z',
      checks: {
        db: { status: 'ok', total: 3, idle: 1, waiting: 0 },
        migrations: { status: 'ok', applied: 47, available: 47 },
        schedulers: { status: 'ok', jobs: [], note: 'no run history in this process' },
        calendar: { status: 'degraded', pendingPush: 0, failedPush: 2, staleCalendars: 1 },
        storage: { status: 'ok', dir: '/data/media', writable: true },
      },
    }
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/health')) return { ok: true, json: async () => report }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('System Health'))

    expect(await screen.findByText('Database')).toBeInTheDocument()
    expect(screen.getByText('Calendar Sync')).toBeInTheDocument()
    expect(screen.getByText(/Build abc123 · fork v0\.8\.0-150-gabc1234/)).toBeInTheDocument()
    expect(screen.getByText(/DEGRADED/)).toBeInTheDocument()
  })

  it('About shows the fork version with its upstream base (any member)', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/version')) return { ok: true, json: async () => ({ pkg: '0.8.0', sha: 'abc1234', fork: 'v0.8.0-150-gabc1234', buildTime: '2026-07-20T10:00:00Z' }) }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      // Non-admin viewer: version info in About must not be admin-gated.
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[1] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderSettings()
    expect(await screen.findByText('Waffled — Family Hub')).toBeInTheDocument() // About is the default landing
    expect(await screen.findByText('v0.8.0-150-gabc1234')).toBeInTheDocument()
    expect(screen.getByText(/upstream base 0\.8\.0/)).toBeInTheDocument()
  })

  it('shows the per-browser Live Sync card in System Health, with a restart button (admin)', async () => {
    const report = {
      status: 'ok',
      version: { pkg: '0.0.0', sha: 'abc123', buildTime: null },
      generatedAt: '2026-06-25T20:00:00Z',
      checks: { db: { status: 'ok', total: 3, idle: 1, waiting: 0 } },
    }
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/health')) return { ok: true, json: async () => report }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch
    // The 2026-07-20 failure mode: engine stalled, watchdog already restarted twice.
    publishSyncHealth({
      status: 'stalled',
      hasSynced: true,
      lastSyncedAt: Date.parse('2026-07-20T18:33:00Z'),
      restartCount: 2,
      lastRestartAt: Date.parse('2026-07-20T18:40:00Z'),
    })

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('System Health'))

    expect(await screen.findByText('Live Sync (this browser)')).toBeInTheDocument()
    expect(screen.getByText(/state: stalled/)).toBeInTheDocument()
    expect(screen.getByText(/watchdog restarts: 2/)).toBeInTheDocument()
    expect(screen.getByText(/last synced:/)).toBeInTheDocument()

    fireEvent.click(screen.getByText(/Restart sync/))
    await waitFor(() => expect(restartHardMock).toHaveBeenCalledTimes(1))

    // A stalled engine also offers the nuclear rung: wipe the local copy and
    // re-download (the manual version of the watchdog's clear escalation).
    fireEvent.click(screen.getByText(/Reset local copy/))
    await waitFor(() => expect(restartHardMock).toHaveBeenLastCalledWith({ clear: true }))
  })

  it('hides Reset local copy when sync is healthy', async () => {
    const report = {
      status: 'ok',
      version: { pkg: '0.0.0', sha: 'abc123', fork: 'dev', buildTime: null },
      generatedAt: '2026-06-25T20:00:00Z',
      checks: { db: { status: 'ok', total: 3, idle: 1, waiting: 0 } },
    }
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/health')) return { ok: true, json: async () => report }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch
    publishSyncHealth({ status: 'ok', hasSynced: true, lastSyncedAt: 1, restartCount: 0, lastRestartAt: null })

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('System Health'))
    expect(await screen.findByText(/Restart sync/)).toBeInTheDocument()
    expect(screen.queryByText(/Reset local copy/)).not.toBeInTheDocument()
  })

  it('Live Sync card distinguishes a failed engine boot (with the error) from off', async () => {
    const report = {
      status: 'ok',
      version: { pkg: '0.0.0', sha: 'abc123', fork: 'dev', buildTime: null },
      generatedAt: '2026-06-25T20:00:00Z',
      checks: { db: { status: 'ok', total: 3, idle: 1, waiting: 0 } },
    }
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/health')) return { ok: true, json: async () => report }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch
    publishSyncHealth({ status: 'failed', hasSynced: null, lastSyncedAt: null, restartCount: 0, lastRestartAt: null, lastError: 'OPFS unavailable' })

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('System Health'))

    expect(await screen.findByText(/state: failed to start — reading over REST/)).toBeInTheDocument()
    expect(screen.getByText(/error: OPFS unavailable/)).toBeInTheDocument()
  })

  it('keeps household kiosk controls available when global sign-in config is forbidden', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/api/auth/config')) return { ok: false, status: 403, json: async () => ({}) }
      if (u.includes('/api/kiosk/devices')) return { ok: true, json: async () => ({ devices: [] }) }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('Sign-in & Security'))

    expect(await screen.findByText(/Only the installation owner can manage/)).toBeInTheDocument()
    expect(await screen.findByText('Kiosk Devices')).toBeInTheDocument()
  })

  it('hides admin-only tabs from non-admins but keeps Display & Kiosk (appearance lives there)', async () => {
    // Same data, but the signed-in person is not an admin.
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (String(url).includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[1] }) } // Wally, not admin
      if (String(url).includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch
    renderSettings()

    expect(await screen.findByText('Waffled — Family Hub')).toBeInTheDocument() // About panel content (default landing)
    expect(screen.getByText('About', { selector: '.set-navitem' })).toBeInTheDocument()
    expect(screen.getByText(/Sign out/, { selector: '.set-signout' })).toBeInTheDocument()
    // The standalone Appearance tab is gone — its options moved under Display & Kiosk,
    // which stays visible to everyone because the theme is a per-device preference.
    expect(screen.queryByText('Appearance', { selector: '.set-navitem' })).not.toBeInTheDocument()
    expect(screen.getByText('Display & Kiosk', { selector: '.set-navitem' })).toBeInTheDocument()
    expect(screen.queryByText('Family & People')).not.toBeInTheDocument()
    expect(screen.queryByText('Sign-in & Security')).not.toBeInTheDocument()

    // A non-admin opening Display & Kiosk gets the appearance controls…
    fireEvent.click(screen.getByText('Display & Kiosk', { selector: '.set-navitem' }))
    expect(await screen.findByText('Match system')).toBeInTheDocument()
    expect(screen.getByText('COLOR THEME')).toBeInTheDocument()
    // …but not the admin-only kiosk/screensaver configuration.
    expect(screen.queryByText('Use this browser as the family display')).not.toBeInTheDocument()
    expect(screen.queryByText('Screensaver after')).not.toBeInTheDocument()
  })

  it('Display & Kiosk hosts the appearance options and the color-theme picker (admin)', async () => {
    localStorage.removeItem('waffled:palette')
    document.documentElement.removeAttribute('data-palette')
    mockApi()
    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('Display & Kiosk'))

    // Light/dark controls moved in from the old Appearance tab.
    expect(await screen.findByText('Match system')).toBeInTheDocument()
    expect(screen.getByText('Follow the sun')).toBeInTheDocument()

    // The color-theme picker lists the palettes and applies one on tap.
    expect(screen.getByText('COLOR THEME')).toBeInTheDocument()
    expect(screen.getByText('Golden Waffle')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Blueberry'))
    expect(localStorage.getItem('waffled:palette')).toBe('blueberry')
    expect(document.documentElement.getAttribute('data-palette')).toBe('blueberry')
    fireEvent.click(screen.getByText('Golden Waffle'))
    expect(localStorage.getItem('waffled:palette')).toBe('waffle')

    // Admins still get the kiosk configuration below.
    expect(screen.getByText('Use this browser as the family display')).toBeInTheDocument()
  })

  it('Meals: the thaw reminder toggle enables the time + meal chips and auto-saves', async () => {
    const mealSettings = {
      addToCalendar: true,
      pushToGoogle: true,
      calendarPersonId: 'p1',
      participantIds: null,
      times: { breakfast: '08:00', lunch: '12:00', dinner: '18:00', snack: '15:00' },
      durationMinutes: 60,
      prepReminder: false, // off by default
      prepReminderTime: '08:00',
      prepReminderMealTypes: ['dinner'],
    }
    const putBodies: Array<Record<string, unknown>> = []
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/api/meals/calendar-settings')) {
        if (init?.method === 'PUT') {
          const patch = JSON.parse(String(init.body)) as Record<string, unknown>
          putBodies.push(patch)
          return { ok: true, json: async () => ({ settings: { ...mealSettings, ...patch } }) }
        }
        return { ok: true, json: async () => ({ settings: mealSettings }) }
      }
      if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household, members }) }
      if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household, person: members[0] }) }
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderSettings()
    await screen.findByText('Kevin')
    fireEvent.click(screen.getByText('Meals')) // nav item

    // The merged card + thaw subsection render with Title-Cased headers.
    expect(await screen.findByText('Meal Times & Reminders')).toBeInTheDocument()
    expect(screen.getByText('Thaw Reminder')).toBeInTheDocument()
    expect(screen.getByText('For Which Meals')).toBeInTheDocument()

    // Off by default → the Dinner meal-type chip is disabled.
    expect(screen.getByRole('button', { name: /Dinner/ })).toBeDisabled()

    // Flip the "Remind me to thaw" toggle on.
    const toggle = within(screen.getByText('Remind me to thaw').closest('.set-row2')!).getByRole('checkbox')
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)

    // The chips (and time) become enabled once the reminder is on.
    await waitFor(() => expect(screen.getByRole('button', { name: /Dinner/ })).not.toBeDisabled())
    expect(toggle).toBeChecked()

    // Debounced auto-save persists prepReminder: true.
    await waitFor(() => expect(putBodies.some((b) => b.prepReminder === true)).toBe(true), { timeout: 2000 })
  })
})
