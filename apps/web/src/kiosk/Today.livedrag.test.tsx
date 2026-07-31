// Live drag on the Today board (no Customize mode): long-press a card to lift it,
// drag between zones (the target zone highlights), release to auto-save.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Today } from './Today'
import type { StoredLayout } from '../lib/api/today-layout'
import { listLeaves } from './zone-layout'

// All optional modules off so effectiveResolved matches the served layout exactly
// (no module cards injected/stripped besides chores, which is on).
const MODULES = { pantry: false, familyNight: false, goals: false, smartHome: false, chores: true, meals: false, lists: false, quotes: false }

const EMPTY = { persons: [], items: [], lists: [], people: [], instances: [], entries: [], events: [], goals: [], photos: [], recipes: [], currencies: [] }

function mockAll(initial: StoredLayout) {
  const state = { layout: initial }
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/today-layout')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { scope: string; layout: StoredLayout }
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
const savedLeaves = () => listLeaves(lastPutBody().layout.zones).map((l) => l.leaf.cards)

async function renderToday(initial: StoredLayout) {
  mockAll(initial)
  render(
    <MemoryRouter>
      <Today />
    </MemoryRouter>
  )
  // Wait for the SERVED layout (countdowns is not in the client fallback) so
  // captured nodes aren't from the pre-fetch fallback tree, which remounts.
  await waitFor(() => expect(slot('countdowns')).toBeTruthy())
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

// A flat row of three zones — leaf paths '0', '1', '2'.
const COLS_ONLY: StoredLayout = {
  zones: { dir: 'row', children: [{ cards: ['agenda'] }, { cards: ['countdowns'] }, { cards: ['chores'] }] },
  hidden: [],
}
// A pinned band over three columns — band '0', columns '1.0'..'1.2'.
const BANDED: StoredLayout = {
  zones: {
    dir: 'col',
    children: [
      { cards: ['weekCalendar'], size: 1 },
      { dir: 'row', children: [{ cards: ['agenda'] }, { cards: ['countdowns'] }, { cards: ['chores'] }] },
    ],
  },
  hidden: [],
}

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
    expect(savedLeaves()).toEqual([[], ['countdowns', 'agenda'], ['chores']])

    await waitFor(() => {
      const zone = document.querySelector('[data-region="1"]') as HTMLElement
      const cards = [...zone.querySelectorAll('.today-slot[data-card]')].map((el) => el.getAttribute('data-card'))
      expect(cards).toEqual(['countdowns', 'agenda'])
    })
    expect(document.querySelector('.today-drag-ghost')).toBeNull()
  })

  it('highlights the zone under the pointer FancyZones-style while dragging', async () => {
    await renderToday(COLS_ONLY)
    await liftAfterHold('agenda')
    stubPoint(document.querySelector('[data-region="1"]'))
    fireEvent(window, pointer('pointermove', 300, 50))
    await waitFor(() => expect(document.querySelector('[data-region="1"]')!.className).toContain('zone-drop-active'))
    expect(document.querySelector('[data-region="0"]')!.className).not.toContain('zone-drop-active')
    fireEvent(window, pointer('pointerup', 300, 50))
    await waitFor(() => expect(puts().length).toBe(1))
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

  it('drags a column card up into the pinned band zone', async () => {
    await renderToday(BANDED)
    await liftAfterHold('agenda')
    stubPoint(document.querySelector('[data-region="0"]'))
    fireEvent(window, pointer('pointermove', 400, 20))
    fireEvent(window, pointer('pointerup', 400, 20))
    await waitFor(() => expect(puts().length).toBe(1))
    const leaves = savedLeaves()
    expect(leaves[0]).toContain('agenda') // the band zone
    expect(leaves.slice(1).flat()).not.toContain('agenda')
  })

  it('drags the calendar out of the band down into a column zone', async () => {
    await renderToday(BANDED)
    await liftAfterHold('weekCalendar')
    stubPoint(document.querySelector('[data-region="1.0"]'))
    fireEvent(window, pointer('pointermove', 100, 50))
    fireEvent(window, pointer('pointerup', 100, 50))
    await waitFor(() => expect(puts().length).toBe(1))
    const leaves = savedLeaves()
    expect(leaves[0]).toEqual([]) // band emptied
    expect(leaves[1]).toContain('weekCalendar')
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
