// The Live preview pane tells you up front which progress views this goal will
// offer (round 2 of the 2026-07-21 request: pills in the preview, where the
// user actually looks, instead of a text line under the measure picker).
import { render, screen, fireEvent, within } from '@testing-library/react'
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

const pane = () => within(document.querySelector('.ge-pv-views') as HTMLElement)
// Pill text is "<glyph> <label>" — strip the leading glyph token.
const pillLabels = () =>
  [...document.querySelectorAll('.ge-pv-views .vpill')].map((p) => (p.textContent ?? '').replace(/^\S+\s/, ''))

describe('GoalCreate progress-view pills in the Live preview', () => {
  it('shows the full six-view strip for a total goal, updating when the type changes', async () => {
    mockApi()
    renderNew()
    expect(await screen.findByText(/Progress views on the goal page/)).toBeInTheDocument()
    expect(pillLabels()).toEqual(['Week', 'Month', 'Year', 'Pace', 'Year ring', 'By person'])

    fireEvent.click(screen.getByText('Habit'))
    expect(pillLabels()).toEqual(['Consistency', 'Week'])

    fireEvent.click(screen.getByText('Count'))
    expect(pillLabels()).toEqual(['Month', 'Pace', 'Collection'])
  })

  it('a short deadline drops the calendar-scale views', async () => {
    mockApi()
    renderNew()
    await screen.findByText(/Progress views on the goal page/)
    const dlToggle = screen.getByText('Set a deadline').closest('.ge-deadline')?.querySelector('[role="switch"]')
    fireEvent.click(dlToggle as HTMLElement)
    const soon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
    fireEvent.change(document.querySelector('.ge-date-input') as HTMLInputElement, { target: { value: soon } })
    expect(pillLabels()).toEqual(['Week', 'Pace', 'By person'])
  })

  it('a checklist explains it tracks by steps instead of showing pills', async () => {
    mockApi()
    renderNew()
    await screen.findByText(/Progress views on the goal page/)
    fireEvent.click(screen.getByText('Checklist'))
    expect(document.querySelectorAll('.ge-pv-views .vpill')).toHaveLength(0)
    expect(pane().getByText(/Tracked by its steps/)).toBeInTheDocument()
  })
})
