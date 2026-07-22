// Live drag on the Today board (no Customize mode): long-press a card to lift
// it, drag between columns, release to auto-save the personal layout.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Today } from './Today'

// All optional modules off so effectiveResolved matches the served layout
// exactly (no module cards injected or stripped besides chores, which is on).
const MODULES = { pantry: false, familyNight: false, goals: false, smartHome: false, chores: true, meals: false, lists: false, quotes: false }

const EMPTY = { persons: [], items: [], lists: [], people: [], instances: [], entries: [], events: [], goals: [], photos: [], recipes: [], currencies: [] }

function mockAll(initialCols: string[][]) {
  const state = { layout: { cols: initialCols, hidden: [] as string[] }, puts: [] as Array<{ scope: string; layout: { cols: string[][]; hidden: string[] } }> }
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/today-layout')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { scope: string; layout: { cols: string[][]; hidden: string[] } }
        state.puts.push(body)
        state.layout = body.layout
        return { ok: true, json: async () => ({ ok: true, layout: body.layout }) }
      }
      return {
        ok: true,
        json: async () => ({ resolved: state.layout, family: state.layout, user: null, source: 'family', cards: [], canEditFamily: false }),
      }
    }
    if (u.includes('/api/household')) {
      return {
        ok: true,
        json: async () => ({
          provisioned: true,
          household: { id: 'h', name: 'Home', timezone: 'UTC', weekStart: 'sunday', settings: { modules: MODULES } },
          person: { id: 'me', name: 'Kevin', memberType: 'adult', isAdmin: false, capabilities: [] },
        }),
      }
    }
    return { ok: true, json: async () => EMPTY }
  }) as unknown as typeof fetch
}

// jsdom has no PointerEvent in some versions — MouseEvents with pointer type
// names hit the same React/window listeners.
const pointer = (type: string, x: number, y: number) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })

const slot = (card: string) => document.querySelector(`.today-slot[data-card="${card}"]`) as HTMLElement

function stubPoint(el: Element | null) {
  ;(document as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => el
}

async function renderToday(cols: string[][]) {
  mockAll(cols)
  render(
    <MemoryRouter>
      <Today />
    </MemoryRouter>
  )
  await waitFor(() => expect(slot('agenda')).toBeTruthy())
}

afterEach(() => {
  vi.useRealTimers()
  delete (document as Partial<Document>).elementFromPoint
})

describe('Today live drag', () => {
  it('long-press lifts a card, drop reorders and saves the personal layout', async () => {
    await renderToday([['agenda'], ['countdowns'], ['chores']])
    vi.useFakeTimers()
    fireEvent(slot('agenda'), pointer('pointerdown', 10, 10))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    vi.useRealTimers()
    expect(document.querySelector('.today-drag-ghost')).toHaveTextContent('Agenda')

    stubPoint(document.querySelector('[data-col="1"]'))
    fireEvent(window, pointer('pointermove', 300, 50))
    fireEvent(window, pointer('pointerup', 300, 50))

    const puts = () =>
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PUT')
    await waitFor(() => expect(puts().length).toBe(1))
    const body = JSON.parse(String((puts()[0][1] as RequestInit).body))
    expect(body.scope).toBe('user')
    expect(body.layout.cols).toEqual([[], ['countdowns', 'agenda'], ['chores']])

    // Board reflects the new order (agenda now lives in column 1, after countdowns).
    await waitFor(() => {
      const col1 = document.querySelector('[data-col="1"]') as HTMLElement
      const cards = [...col1.querySelectorAll('.today-slot')].map((el) => el.getAttribute('data-card'))
      expect(cards).toEqual(['countdowns', 'agenda'])
    })
    expect(document.querySelector('.today-drag-ghost')).toBeNull()
  })

  it('a finger that moves before the hold fires never lifts (scroll wins)', async () => {
    await renderToday([['agenda'], ['countdowns'], ['chores']])
    vi.useFakeTimers()
    fireEvent(slot('agenda'), pointer('pointerdown', 10, 10))
    fireEvent(window, pointer('pointermove', 40, 10)) // > slop before the timer
    act(() => {
      vi.advanceTimersByTime(500)
    })
    vi.useRealTimers()
    expect(document.querySelector('.today-drag-ghost')).toBeNull()
    fireEvent(window, pointer('pointerup', 40, 10))
    const puts = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PUT')
    expect(puts.length).toBe(0)
  })

  it('pressing an interactive element inside a card never lifts', async () => {
    await renderToday([['agenda'], ['countdowns'], ['chores']])
    const btn = await screen.findByRole('button', { name: /All/i }) // AgendaCard's filter pill
    vi.useFakeTimers()
    fireEvent(btn, pointer('pointerdown', 10, 10))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    vi.useRealTimers()
    expect(document.querySelector('.today-drag-ghost')).toBeNull()
  })

  it('pointercancel during the hold aborts the lift', async () => {
    await renderToday([['agenda'], ['countdowns'], ['chores']])
    vi.useFakeTimers()
    fireEvent(slot('agenda'), pointer('pointerdown', 10, 10))
    fireEvent(window, pointer('pointercancel', 10, 10))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    vi.useRealTimers()
    expect(document.querySelector('.today-drag-ghost')).toBeNull()
  })
})
