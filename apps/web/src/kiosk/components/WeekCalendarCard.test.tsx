// FamilyBoard-style Week calendar card: 7 day columns honoring the household
// week start, today ringed, events stacked as solid person-color blocks, a
// per-device people filter, and a live pulse on in-progress events.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WeekCalendarCard } from './WeekCalendarCard'
import { startOfWeekFor, addDays, ymd } from './cal-utils'

// Bucketing runs through the household timezone — pin it to the device zone so
// local-ISO fixtures land on the intended day everywhere.
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

const ws = startOfWeekFor(new Date(), 'monday')
const thu = addDays(ws, 3)

const EVENTS = [
  { id: 'e1', title: 'Dentist', startsAt: `${ymd(thu)}T13:00:00`, endsAt: null, allDay: false, personId: 'p1', personName: 'Addison', personColor: '#E0548B', personEmoji: '🦷', participants: [] },
  { id: 'e2', title: 'Camp week', startsAt: `${ymd(ws)}T00:00:00`, endsAt: null, allDay: true, personId: 'p2', personName: 'Riley', personColor: '#25A368', personEmoji: '🐢', participants: [] },
  { id: 'e3', title: 'Breakfast', startsAt: `${ymd(ws)}T09:00:00`, endsAt: null, allDay: false, personId: 'p2', personName: 'Riley', personColor: '#25A368', personEmoji: '🐢', participants: [] },
]

const PERSONS = [
  { id: 'p1', name: 'Addison', colorHex: '#E0548B', avatarEmoji: '🦷' },
  { id: 'p2', name: 'Riley', colorHex: '#25A368', avatarEmoji: '🐢' },
]

function mockAll(weekStart = 'monday', settings: Record<string, unknown> = {}, opts: { events?: unknown[]; persons?: unknown[] } = {}) {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/events?from=')) return { ok: true, json: async () => ({ events: opts.events ?? EVENTS }) }
    if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: opts.persons ?? [] }) }
    if (u.includes('/api/household')) {
      return {
        ok: true,
        json: async () => ({
          provisioned: true,
          household: { id: 'h', name: 'Home', timezone: TZ, weekStart, settings },
          person: { id: 'me', name: 'Kevin', memberType: 'adult', isAdmin: false, capabilities: [] },
        }),
      }
    }
    return { ok: true, json: async () => ({ persons: [], events: [] }) }
  }) as unknown as typeof fetch
}

function Probe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname}</div>
}

function renderCard() {
  return render(
    <MemoryRouter>
      <WeekCalendarCard />
      <Probe />
    </MemoryRouter>
  )
}

describe('WeekCalendarCard', () => {
  it('renders 7 day columns starting on the household week start (Monday)', async () => {
    mockAll('monday')
    renderCard()
    await screen.findByText('Dentist')
    const cols = document.querySelectorAll('.wkc-col')
    expect(cols.length).toBe(7)
    expect(cols[0].querySelector('.wkc-dow')?.textContent).toBe('Mon')
    expect(cols[0].getAttribute('data-date')).toBe(ymd(ws))
  })

  it('rings today\'s column header', async () => {
    mockAll('monday')
    renderCard()
    await screen.findByText('Dentist')
    const today = document.querySelector('.wkc-day-h.today')
    expect(today).toBeTruthy()
    expect(today?.querySelector('.wkc-dn')?.textContent).toBe(String(new Date().getDate()))
  })

  it('stacks events in their day column as solid person-color blocks (via --ev only)', async () => {
    mockAll('monday')
    renderCard()
    const title = await screen.findByText('Dentist')
    const block = title.closest('.wkc-ev') as HTMLElement
    expect(block).toBeTruthy()
    expect(block.closest('[data-date]')?.getAttribute('data-date')).toBe(ymd(thu))
    expect(block.textContent).toContain('1p')
    // Solid coloring flows through the CSS var hook — never inline colors.
    expect(block.style.getPropertyValue('--ev')).toBe('#E0548B')
    expect(block.style.backgroundColor).toBe('')
    expect(block.style.color).toBe('')
  })

  it('pins all-day events above timed ones in the same column', async () => {
    mockAll('monday')
    renderCard()
    await screen.findByText('Camp week')
    const monday = document.querySelector(`[data-date="${ymd(ws)}"]`) as HTMLElement
    const blocks = [...monday.querySelectorAll('.wkc-ev')].map((el) => el.textContent ?? '')
    expect(blocks.length).toBe(2)
    expect(blocks[0]).toContain('Camp week')
    expect(blocks[0]).toContain('all day')
    expect(blocks[1]).toContain('Breakfast')
  })

  it('opens an event on tap', async () => {
    mockAll('monday')
    renderCard()
    fireEvent.click(await screen.findByText('Dentist'))
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/calendar/event/e1'))
  })

  it('starts on Sunday when the household says so', async () => {
    mockAll('sunday')
    renderCard()
    await screen.findByText('Dentist')
    await waitFor(() => {
      const first = document.querySelector('.wkc-col')
      expect(first?.querySelector('.wkc-dow')?.textContent).toBe('Sun')
    })
  })

  it('separates the days into bordered cells by default', async () => {
    mockAll('monday')
    renderCard()
    await screen.findByText('Dentist')
    await waitFor(() => expect(document.querySelector('.wkc-grid.wkc-separated')).toBeTruthy())
  })

  it('uses the plain continuous style when the household chose it', async () => {
    mockAll('monday', { display: { weekCard: 'plain' } })
    renderCard()
    await screen.findByText('Dentist')
    await waitFor(() => expect(document.querySelector('.wkc-grid')).toBeTruthy())
    expect(document.querySelector('.wkc-grid.wkc-separated')).toBeNull()
  })
})

describe('WeekCalendarCard people filter (per-device)', () => {
  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('renders a chip per member and filters the week when one is toggled, persisting the choice', async () => {
    mockAll('monday', {}, { persons: PERSONS })
    renderCard()
    await screen.findByText('Dentist')
    const riley = await screen.findByRole('button', { name: /Riley/ })
    expect(screen.getByRole('button', { name: /Addison/ })).toBeTruthy()
    // The chips share the header row with the title and the Calendar button —
    // no separate row eating vertical space.
    expect(document.querySelector('.wkc-head-row .wkc-chips')).toBeTruthy()

    fireEvent.click(riley)
    await waitFor(() => expect(screen.queryByText('Dentist')).not.toBeInTheDocument()) // Addison's event filtered out
    expect(screen.getByText('Breakfast')).toBeInTheDocument() // Riley's stays
    expect(JSON.parse(localStorage.getItem('waffled.wkcPeople') ?? '[]')).toEqual(['p2'])
  })

  it('hydrates the stored selection on mount and prunes ids of removed members', async () => {
    localStorage.setItem('waffled.wkcPeople', JSON.stringify(['p2', 'ghost']))
    mockAll('monday', {}, { persons: PERSONS })
    renderCard()
    await screen.findByText('Breakfast')
    expect(screen.queryByText('Dentist')).not.toBeInTheDocument() // filter applied from storage
    await waitFor(() => expect(JSON.parse(localStorage.getItem('waffled.wkcPeople') ?? '[]')).toEqual(['p2']))
  })
})

describe('WeekCalendarCard in-progress pulse', () => {
  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('marks events happening right now and follows transitions on the minute tick', async () => {
    const base = new Date()
    base.setHours(12, 0, 0, 0)
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(base)
    const day = ymd(base)
    mockAll('monday', {}, {
      events: [
        { id: 'n1', title: 'Standup', startsAt: `${day}T11:30:00`, endsAt: `${day}T12:30:00`, allDay: false, personId: 'p1', personName: 'Addison', personColor: '#E0548B', personEmoji: null, participants: [] },
        { id: 'n2', title: 'Review', startsAt: `${day}T12:45:00`, endsAt: `${day}T13:45:00`, allDay: false, personId: 'p1', personName: 'Addison', personColor: '#E0548B', personEmoji: null, participants: [] },
        { id: 'n3', title: 'Camp', startsAt: `${day}T00:00:00`, endsAt: null, allDay: true, personId: null, personName: null, personColor: null, personEmoji: null, participants: [] },
      ],
    })
    renderCard()
    const standup = (await screen.findByText('Standup')).closest('.wkc-ev') as HTMLElement
    expect(standup.className).toContain('wkc-ev--now')
    expect((screen.getByText('Review').closest('.wkc-ev') as HTMLElement).className).not.toContain('wkc-ev--now')
    expect((screen.getByText('Camp').closest('.wkc-ev') as HTMLElement).className).not.toContain('wkc-ev--now') // all-day never pulses

    // An hour later: Standup ended, Review is live — the minute tick picks it up.
    act(() => {
      vi.advanceTimersByTime(60 * 60000)
    })
    expect((screen.getByText('Review').closest('.wkc-ev') as HTMLElement).className).toContain('wkc-ev--now')
    expect((screen.getByText('Standup').closest('.wkc-ev') as HTMLElement).className).not.toContain('wkc-ev--now')
  })
})
