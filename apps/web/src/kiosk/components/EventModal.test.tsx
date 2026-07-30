import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactElement } from 'react'
import { EventModal } from './EventModal'

// EventModal uses useNavigate (the "View recipe" jump), so it needs a Router.
const renderModal = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('EventModal', () => {
  it('creates an event with the entered details', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    globalThis.fetch = vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      if (String(url).includes('/api/persons')) {
        return { ok: true, json: async () => ({ persons: [] }) }
      }
      if (String(url).includes('/api/events') && opts?.method === 'POST') {
        calls.push({ url: String(url), body: JSON.parse(opts.body!) })
        return { ok: true, json: async () => ({ event: { id: 'e1' } }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    const onClose = vi.fn()
    const onSaved = vi.fn()
    renderModal(<EventModal date="2026-06-09" onClose={onClose} onSaved={onSaved} />)

    fireEvent.change(screen.getByPlaceholderText('Soccer practice'), { target: { value: 'Dentist' } })
    fireEvent.click(screen.getByRole('button', { name: /Add event/ }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toMatchObject({ title: 'Dentist', allDay: false })
    expect(typeof calls[0].body.startsAt).toBe('string')
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })

  it('creates an event with an exact end time (End time mode)', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = []
    globalThis.fetch = vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      if (String(url).includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      if (String(url).includes('/api/events') && opts?.method === 'POST') {
        calls.push({ body: JSON.parse(opts.body!) })
        return { ok: true, json: async () => ({ event: { id: 'e1' } }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderModal(<EventModal date="2026-06-09" time="17:00" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Soccer practice'), { target: { value: 'Recital' } })
    fireEvent.click(screen.getByRole('button', { name: 'End time' }))
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '18:20' } })
    fireEvent.click(screen.getByRole('button', { name: /Add event/ }))

    await waitFor(() => expect(calls).toHaveLength(1))
    const { startsAt, endsAt } = calls[0].body as { startsAt: string; endsAt: string }
    expect((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000).toBe(80)
  })

  it('rolls an end time at/before the start over to the next day', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = []
    globalThis.fetch = vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      if (String(url).includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      if (String(url).includes('/api/events') && opts?.method === 'POST') {
        calls.push({ body: JSON.parse(opts.body!) })
        return { ok: true, json: async () => ({ event: { id: 'e1' } }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderModal(<EventModal date="2026-06-09" time="23:00" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Soccer practice'), { target: { value: 'NYE-ish' } })
    fireEvent.click(screen.getByRole('button', { name: 'End time' }))
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '00:30' } })
    fireEvent.click(screen.getByRole('button', { name: /Add event/ }))

    await waitFor(() => expect(calls).toHaveLength(1))
    const { startsAt, endsAt } = calls[0].body as { startsAt: string; endsAt: string }
    expect((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000).toBe(90)
  })

  it('opens a non-preset-length event in End time mode and preserves the exact end', async () => {
    const patched: Array<Record<string, unknown>> = []
    globalThis.fetch = vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      const u = String(url)
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      if (/\/api\/events\/[^/]+$/.test(u) && opts?.method === 'PATCH') {
        patched.push(JSON.parse(opts.body!))
        return { ok: true, json: async () => ({ event: { id: 'e1' } }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    // 20 minutes — not one of the duration presets (a synced calendar can produce this).
    const ev = { ...sampleEvent, startsAt: '2026-06-09T22:00:00Z', endsAt: '2026-06-09T22:20:00Z' }
    renderModal(<EventModal event={ev} onClose={vi.fn()} onSaved={vi.fn()} />)
    // The form opens in End-time mode (no snapping to a preset)…
    expect((screen.getByLabelText('End time') as HTMLInputElement).value).not.toBe('')
    // …and saving untouched keeps the exact 20-minute end.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(patched).toHaveLength(1))
    const { startsAt, endsAt } = patched[0] as { startsAt: string; endsAt: string }
    expect((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000).toBe(20)
  })

  it('selects the whole family with the Everyone chip', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = []
    globalThis.fetch = vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      const u = String(url)
      if (u.includes('/api/persons'))
        return { ok: true, json: async () => ({ persons: [
          { id: 'p1', name: 'Kevin', colorHex: '#2F7FED', avatarEmoji: null },
          { id: 'p2', name: 'Kelly', colorHex: '#EC6049', avatarEmoji: null },
        ] }) }
      if (u.includes('/api/events') && opts?.method === 'POST') {
        calls.push({ body: JSON.parse(opts.body!) })
        return { ok: true, json: async () => ({ event: { id: 'e1' } }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderModal(<EventModal date="2026-06-09" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Soccer practice'), { target: { value: 'Beach day' } })
    fireEvent.click(await screen.findByRole('button', { name: /Everyone/ }))
    fireEvent.click(screen.getByRole('button', { name: /Add event/ }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body.participantIds).toEqual(expect.arrayContaining(['p1', 'p2']))
  })

  const sampleEvent = {
    id: 'e1',
    title: 'Old title',
    startsAt: '2026-06-09T22:00:00Z',
    endsAt: null,
    allDay: false,
    location: null,
    personId: null,
    personName: null,
    personColor: null,
    personEmoji: null,
    participants: [],
  }

  function mockEventApi(
    patched: unknown[],
    deleted: string[],
    master?: typeof sampleEvent & { rrule: string; recurrenceEndAt?: string | null }
  ) {
    globalThis.fetch = vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      const u = String(url)
      if (u.includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      if (/\/api\/events\/[^/?]+$/.test(u) && !opts?.method && master) {
        return { ok: true, json: async () => ({ event: master }) }
      }
      if (/\/api\/events\/[^/]+$/.test(u) && opts?.method === 'PATCH') {
        patched.push(JSON.parse(opts.body!))
        return { ok: true, json: async () => ({ event: { id: 'e1' } }) }
      }
      if (/\/api\/events\/[^/]+$/.test(u) && opts?.method === 'DELETE') {
        deleted.push(u)
        return { ok: true, status: 204, json: async () => ({}) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch
  }

  it('edits an existing event (PATCH)', async () => {
    const patched: unknown[] = []
    mockEventApi(patched, [])
    renderModal(<EventModal event={sampleEvent} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Old title'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({ title: 'New title' })
  })

  it('deletes only after a confirm tap', async () => {
    const deleted: string[] = []
    mockEventApi([], deleted)
    renderModal(<EventModal event={sampleEvent} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleted).toHaveLength(0) // first tap just confirms
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to delete' }))
    await waitFor(() => expect(deleted).toHaveLength(1))
  })

  it('renders the Repeats control with weekly day chips', () => {
    mockEventApi([], [])
    renderModal(<EventModal date="2026-06-22" onClose={vi.fn()} onSaved={vi.fn()} />)
    // The Repeats select starts on "Does not repeat".
    const repeats = screen.getByDisplayValue('Does not repeat')
    fireEvent.change(repeats, { target: { value: 'weekly' } })
    // Day chips (one per weekday) surface once weekly is chosen.
    expect(screen.getByRole('button', { name: 'MO' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'FR' })).toBeTruthy()
  })

  it('creates a recurring event with an rrule via REST', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    globalThis.fetch = vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      if (String(url).includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
      if (String(url).includes('/api/events') && opts?.method === 'POST') {
        calls.push({ url: String(url), body: JSON.parse(opts.body!) })
        return { ok: true, json: async () => ({ event: { id: 'e1' } }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    renderModal(<EventModal date="2026-06-22" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Soccer practice'), { target: { value: 'Standup' } })
    fireEvent.change(screen.getByDisplayValue('Does not repeat'), { target: { value: 'weekly' } })
    fireEvent.click(screen.getByRole('button', { name: /Add event/ }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body).toMatchObject({ title: 'Standup' })
    expect(String(calls[0].body.rrule)).toContain('FREQ=WEEKLY')
  })

  it('surfaces the edit-scope dialog when saving an already-recurring event', async () => {
    const patched: unknown[] = []
    mockEventApi(patched, [])
    const recurring = { ...sampleEvent, rrule: 'FREQ=WEEKLY;BYDAY=MO', seriesId: 'e1', occurrenceStart: '2026-06-22T22:00:00Z' }
    renderModal(<EventModal event={recurring} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Old title'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    // Save does not fire immediately — the scope chooser appears first.
    expect(patched).toHaveLength(0)
    const thisOne = await screen.findByRole('button', { name: 'This event' })
    fireEvent.click(thisOne)
    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({ title: 'New title', scope: 'this', occurrenceStart: '2026-06-22T22:00:00Z' })
    expect(patched[0]).not.toHaveProperty('allDay')
    expect(patched[0]).not.toHaveProperty('isCountdown')
    expect(patched[0]).not.toHaveProperty('participantIds')
    expect(patched[0]).not.toHaveProperty('goalId')
    expect(patched[0]).not.toHaveProperty('rrule')
  })

  it('recognizes a recurring master without an occurrence timestamp', async () => {
    const patched: Array<Record<string, unknown>> = []
    mockEventApi(patched, [])
    const recurringMaster = { ...sampleEvent, rrule: 'FREQ=WEEKLY;BYDAY=MO' }
    renderModal(<EventModal event={recurringMaster} onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.change(screen.getByDisplayValue('Old title'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(patched).toHaveLength(0)
    fireEvent.click(await screen.findByRole('button', { name: 'All events' }))
    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({ title: 'New title', scope: 'all' })
  })

  it('hydrates recurrence before editing a locally streamed occurrence', async () => {
    const patched: Array<Record<string, unknown>> = []
    const master = {
      ...sampleEvent,
      id: 'series-1',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      recurrenceEndAt: null,
    }
    mockEventApi(patched, [], master)
    const localOccurrence = {
      ...sampleEvent,
      id: 'occurrence-1',
      startsAt: '2026-06-22T22:00:00Z',
      seriesId: 'series-1',
      occurrenceStart: '2026-06-22T22:00:00Z',
    }
    renderModal(<EventModal event={localOccurrence} onClose={vi.fn()} onSaved={vi.fn()} />)

    await waitFor(() => expect(screen.getByDisplayValue('Weekly')).toBeTruthy())
    fireEvent.change(screen.getByDisplayValue('Old title'), { target: { value: 'New title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'This event' }))

    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({
      title: 'New title',
      scope: 'this',
      occurrenceStart: '2026-06-22T22:00:00Z',
    })
  })

  it('requires a series scope when series-only fields changed', async () => {
    const patched: Array<Record<string, unknown>> = []
    mockEventApi(patched, [])
    const recurring = {
      ...sampleEvent,
      isCountdown: false,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      seriesId: 'e1',
      occurrenceStart: '2026-06-22T22:00:00Z',
    }
    renderModal(<EventModal event={recurring} onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByLabelText(/Show a countdown/))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const thisOne = await screen.findByRole('button', { name: 'This event' })
    expect(thisOne).toBeDisabled()
    expect(screen.getByText(/Choose “This and following events” or “All events”/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'This and following events' }))
    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toMatchObject({
      scope: 'following',
      isCountdown: true,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    })
  })
})
