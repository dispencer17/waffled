// The goal editor tells you up front which progress views this goal will offer
// (user request 2026-07-21: the changelog promised swappable views, but which
// ones appear depends on type + timeframe — say so where the goal is made).
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { GoalCreate } from './GoalCreate'

const lists = [
  {
    id: 'l1', name: 'Wally', emoji: '🐢', colorHex: '#25A368', isPrivate: false, sortOrder: 0,
    members: [{ personId: 'p1', name: 'Wally', avatarEmoji: '🐢', colorHex: '#25A368' }], goalCount: 0,
  },
]
const adult = { id: 'p1', name: 'Wally', memberType: 'adult', isAdmin: true, capabilities: ['goal.manage'] }

function mockApi() {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/goal-lists')) return { ok: true, json: async () => ({ lists }) }
    if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household: { id: 'h', name: 'Home', timezone: 'UTC', weekStart: 'sunday' }, person: adult }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

const renderNew = () =>
  render(
    <MemoryRouter initialEntries={['/goals/new']}>
      <Routes>
        <Route path="/goals/new" element={<GoalCreate />} />
      </Routes>
    </MemoryRouter>
  )

describe('GoalCreate progress-view hint', () => {
  it('lists the views a total goal will offer, and updates when the type changes', async () => {
    mockApi()
    renderNew()
    // Default type is total, no deadline → the full six-view line.
    expect(await screen.findByText(/Progress views:/)).toBeInTheDocument()
    expect(screen.getByText(/Week · Month · Year · Pace · Year ring · By person/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Habit'))
    expect(screen.getByText(/Consistency · Week/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Count'))
    expect(screen.getByText(/Month · Pace · Collection/)).toBeInTheDocument()
  })

  it('a short deadline drops the calendar-scale views', async () => {
    mockApi()
    renderNew()
    await screen.findByText(/Progress views:/)
    // Open the deadline (the Toggle button sits beside the label) and pick a
    // date ~2 weeks out.
    const dlToggle = screen.getByText('Set a deadline').closest('.ge-deadline')?.querySelector('[role="switch"]')
    fireEvent.click(dlToggle as HTMLElement)
    const soon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
    fireEvent.change(document.querySelector('.ge-date-input') as HTMLInputElement, { target: { value: soon } })
    expect(screen.getByText(/Week · Pace · By person/)).toBeInTheDocument()
    expect(screen.queryByText(/Year ring/)).not.toBeInTheDocument()
  })

  it('a checklist shows its steps note instead of a view list', async () => {
    mockApi()
    renderNew()
    await screen.findByText(/Progress views:/)
    fireEvent.click(screen.getByText('Checklist'))
    expect(screen.queryByText(/Progress views:/)).not.toBeInTheDocument()
  })
})
