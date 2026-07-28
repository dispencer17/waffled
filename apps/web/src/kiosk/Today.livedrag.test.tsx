// Live drag on the Today board (no Customize mode): long-press a card to lift it,
// drag between the full-width band and the columns, release to auto-save.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Today } from './Today'

// All optional modules off so effectiveResolved matches the served layout exactly
// (no module cards injected/stripped besides chores, which is on).
const MODULES = { pantry: false, familyNight: false, goals: false, smartHome: false, chores: true, meals: false, lists: false, quotes: false }

const EMPTY = { persons: [], items: [], lists: [], people: [], instances: [], entries: [], events: [], goals: [], photos: [], recipes: [], currencies: [] }

type Layout = { full: string[]; cols: string[][]; hidden: string[] }

function mockAll(initial: Layout) {
  const state = { layout: initial }
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/today-layout')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { scope: string; layout: Layout }
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

// jsdom's PointerEvent is patchy — MouseEvents with pointer-type names hit the
// same React/window listeners.
const pointer = (type: string, x: number, y: number) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })

const slot = (card: string) => document.querySelector(`.today-slot[data-card="${card}"]`) as HTMLElement

function stubPoint(el: Element | null) {
  ;(document as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => el
}

const puts = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PUT')
const lastPutBody = () => JSON.parse(String((puts().at(-1)![1] as RequestInit).body))

async function renderToday(initial: Layout) {
  mockAll(initial)
  render(
    <MemoryRouter>
      <Today />
    </MemoryRouter>
  )
  await waitFor(() => expect(slot('agenda')).toBeTruthy())
}

async function liftAfterHold(card: string) {
  vi.useFakeTimers()
  fireEvent(slot(card), pointer('pointerdown', 10, 10))
  act(() => {
    vi.advanceTimersByTime(500)
  })
  vi.useRealTimers()
}

afterEach(() => {
  vi.useRealTimers()
  delete (document as Partial<Document>).elementFromPoint
})

const COLS_ONLY: Layout = { full: [], cols: [['agenda'], ['countdowns'], ['chores']], hidden: [] }

describe('Today live drag', () => {
  it('long-press lifts a card, drop reorders and saves the personal layout', async () => {
    await renderToday(COLS_ONLY)
    await liftAfterHold('agenda')
    expect(document.querySelector('.today-drag-ghost')).toHaveTextContent('Agenda')

    stubPoint(document.querySelector('[data-region="1"]'))
    fireEvent(window, pointer('pointermove', 300, 50))
    fireEvent(window, pointer('pointerup', 300, 50))

    await waitFor(() => expect(puts().length).toBe(1))
    const body = lastPutBody()
    expect(body.scope).toBe('user')
    expect(body.layout.cols).toEqual([[], ['countdowns', 'agenda'], ['chores']])
    expect(body.layout.full).toEqual([])

    await waitFor(() => {
      const col1 = document.querySelector('[data-region="1"]') as HTMLElement
      const cards = [...col1.querySelectorAll('.today-slot[data-card]')].map((el) => el.getAttribute('data-card'))
      expect(cards).toEqual(['countdowns', 'agenda'])
    })
    expect(document.querySelector('.today-drag-ghost')).toBeNull()
  })

  it('does NOT remove the pressed card from the DOM on lift (touch pointer-capture fix)', async () => {
    // Removing the pressed element mid-drag fires pointercancel on touch (implicit
    // pointer capture) → the drag snaps back. The source card must stay mounted.
    await renderToday(COLS_ONLY)
    const agendaNode = slot('agenda')
    await liftAfterHold('agenda')
    expect(agendaNode.isConnected).toBe(true) // same node, still in the DOM
    expect(agendaNode.className).toContain('dragging-source')
    expect(agendaNode.getAttribute('data-card')).toBeNull() // skipped by dropTargetAt
  })

  it('drags a column card up into the full-width band', async () => {
    await renderToday(COLS_ONLY)
    await liftAfterHold('agenda')
    stubPoint(document.querySelector('[data-region="full"]'))
    fireEvent(window, pointer('pointermove', 400, 20))
    fireEvent(window, pointer('pointerup', 400, 20))
    await waitFor(() => expect(puts().length).toBe(1))
    const body = lastPutBody()
    expect(body.layout.full).toContain('agenda')
    expect(body.layout.cols.flat()).not.toContain('agenda')
  })

  it('drags the calendar out of the band down into a column', async () => {
    await renderToday({ full: ['weekCalendar'], cols: [['agenda'], ['countdowns'], ['chores']], hidden: [] })
    await liftAfterHold('weekCalendar')
    stubPoint(document.querySelector('[data-region="0"]'))
    fireEvent(window, pointer('pointermove', 100, 50))
    fireEvent(window, pointer('pointerup', 100, 50))
    await waitFor(() => expect(puts().length).toBe(1))
    const body = lastPutBody()
    expect(body.layout.full).toEqual([])
    expect(body.layout.cols.flat()).toContain('weekCalendar')
  })

  it('a finger that moves before the hold fires never lifts (scroll wins)', async () => {
    await renderToday(COLS_ONLY)
    vi.useFakeTimers()
    fireEvent(slot('agenda'), pointer('pointerdown', 10, 10))
    fireEvent(window, pointer('pointermove', 40, 10)) // > slop before the timer
    act(() => {
      vi.advanceTimersByTime(500)
    })
    vi.useRealTimers()
    expect(document.querySelector('.today-drag-ghost')).toBeNull()
    fireEvent(window, pointer('pointerup', 40, 10))
    expect(puts().length).toBe(0)
  })

  it('pressing an interactive element inside a card never lifts', async () => {
    await renderToday(COLS_ONLY)
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
    await renderToday(COLS_ONLY)
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
