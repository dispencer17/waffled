import { render, screen } from '@testing-library/react'
import { AgendaCard } from './AgendaCard'
import { CardSlotCtx } from '../today-card-slot'

function mockEvents(events: unknown[]) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ date: '2026-06-08', events }),
  })) as unknown as typeof fetch
}

describe('AgendaCard', () => {
  it("renders today's events with the all-day label and count", async () => {
    mockEvents([
      {
        id: '1',
        title: 'Swim lessons',
        startsAt: '2026-06-08T13:30:00Z',
        endsAt: null,
        allDay: false,
        location: null,
        personId: 'p',
        personName: 'Wally',
        personColor: '#25A368',
        personEmoji: '🐢',
      },
      {
        id: '2',
        title: 'Recital tickets',
        startsAt: '2026-06-08T12:00:00Z',
        endsAt: null,
        allDay: true,
        location: null,
        personId: null,
        personName: null,
        personColor: null,
        personEmoji: null,
      },
    ])
    render(<AgendaCard />)
    expect(await screen.findByText('Swim lessons')).toBeInTheDocument()
    expect(screen.getByText('Recital tickets')).toBeInTheDocument()
    expect(screen.getByText('all day')).toBeInTheDocument()
    expect(screen.getByText('2 events')).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    mockEvents([])
    render(<AgendaCard />)
    expect(await screen.findByText(/Nothing on the calendar today/)).toBeInTheDocument()
  })

  it('hides already-ended events via the hideEnded quiet setting', async () => {
    const now = Date.now()
    const iso = (deltaMin: number) => new Date(now + deltaMin * 60000).toISOString()
    mockEvents([
      { id: '1', title: 'Morning run', startsAt: iso(-180), endsAt: iso(-120), allDay: false, location: null, personId: null, personName: null, personColor: null, personEmoji: null },
      { id: '2', title: 'Dinner out', startsAt: iso(120), endsAt: iso(180), allDay: false, location: null, personId: null, personName: null, personColor: null, personEmoji: null },
    ])
    render(
      <CardSlotCtx.Provider value={{ reportEmpty: () => {}, cardOptions: { hideEnded: true } }}>
        <AgendaCard />
      </CardSlotCtx.Provider>
    )
    expect(await screen.findByText('Dinner out')).toBeInTheDocument()
    expect(screen.queryByText('Morning run')).not.toBeInTheDocument()
    expect(screen.getByText('1 event')).toBeInTheDocument() // the count reflects the quieted list
  })
})
