// FamilyBoard-style Week calendar card: 7 day columns honoring the household
// week start, today ringed, events stacked as solid person-color blocks.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
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

function mockAll(weekStart = 'monday', settings: Record<string, unknown> = {}) {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/events?from=')) return { ok: true, json: async () => ({ events: EVENTS }) }
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
