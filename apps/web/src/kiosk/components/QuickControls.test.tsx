import { render, screen, fireEvent } from '@testing-library/react'
import { QuickControlsCard } from './QuickControls'

interface Ent {
  entityId: string
  name: string
  domain: string
  state: string
}

const ok = (body: unknown) => ({ ok: true, json: async () => body })

// A stateful mock of the two HA endpoints the card uses: pinned-entity states
// and service calls (which the stub applies so the follow-up refetch sees them).
function mockHa(initial: Ent[]) {
  let entities = [...initial]
  const calls: Array<{ domain: string; service: string; entityId: string }> = []
  globalThis.fetch = vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
    const u = String(url)
    const method = opts?.method ?? 'GET'
    if (u.endsWith('/api/homeassistant/entities') && method === 'GET') return ok({ entities })
    if (u.endsWith('/api/homeassistant/service') && method === 'POST') {
      const b = JSON.parse(opts!.body!) as { domain: string; service: string; entityId: string }
      calls.push(b)
      if (b.service === 'toggle') {
        entities = entities.map((e) =>
          e.entityId === b.entityId ? { ...e, state: e.state === 'on' ? 'off' : 'on' } : e
        )
      }
      return ok({ ok: true })
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
  return calls
}

describe('QuickControlsCard', () => {
  it('renders the pinned entities with their states', async () => {
    mockHa([
      { entityId: 'light.kitchen', name: 'Kitchen Lights', domain: 'light', state: 'on' },
      { entityId: 'scene.movie', name: 'Movie Night', domain: 'scene', state: 'scening' },
    ])
    render(<QuickControlsCard />)
    expect(await screen.findByText('Kitchen Lights')).toBeInTheDocument()
    expect(screen.getByLabelText('Kitchen Lights: On')).toBeInTheDocument()
    // One-shot domains read "Run", not a state.
    expect(screen.getByLabelText('Movie Night: Run')).toBeInTheDocument()
  })

  it('shows the empty hint when nothing is pinned', async () => {
    mockHa([])
    render(<QuickControlsCard />)
    expect(await screen.findByText(/No devices pinned yet/)).toBeInTheDocument()
  })

  it('tapping a light fires the toggle service and flips optimistically', async () => {
    const calls = mockHa([{ entityId: 'light.kitchen', name: 'Kitchen Lights', domain: 'light', state: 'on' }])
    render(<QuickControlsCard />)
    fireEvent.click(await screen.findByLabelText('Kitchen Lights: On'))
    // Optimistic flip is immediate — no waiting on the server round-trip.
    expect(screen.getByLabelText('Kitchen Lights: Off')).toBeInTheDocument()
    expect(calls).toEqual([{ domain: 'light', service: 'toggle', entityId: 'light.kitchen' }])
  })

  it('display-only entities are not tappable', async () => {
    const calls = mockHa([{ entityId: 'lock.front', name: 'Front Door', domain: 'lock', state: 'locked' }])
    render(<QuickControlsCard />)
    const lock = (await screen.findByLabelText('Front Door: locked')) as HTMLButtonElement
    expect(lock.disabled).toBe(true)
    fireEvent.click(lock)
    expect(calls).toEqual([])
  })
})
