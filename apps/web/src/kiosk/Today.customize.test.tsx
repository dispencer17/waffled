// Customize mode: draggable zone dividers (pinned heights + width ratios) that
// are visible in both modes and persist with "Save for me"; zone editor tools.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Today } from './Today'
import { TopbarSlotProvider, useTopbarSlots } from './topbar-slot'
import type { StoredLayout } from '../lib/api/today-layout'
import { listLeaves, type ZoneNode, type ZoneSplit } from './zone-layout'

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
      return { ok: true, json: async () => ({ resolved: state.layout, family: state.layout, user: null, source: 'family', cards: [], canEditFamily: false }) }
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

const pointer = (type: string, x: number, y: number) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
const puts = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PUT')
const lastPutBody = () => JSON.parse(String((puts().at(-1)![1] as RequestInit).body))

// Renders the topbar's right slot (where the Customize button lives) so tests can click it.
function Slot() {
  return <>{useTopbarSlots().right}</>
}

async function renderToday(initial: StoredLayout) {
  mockAll(initial)
  render(
    <MemoryRouter>
      <TopbarSlotProvider>
        <Today />
        <Slot />
      </TopbarSlotProvider>
    </MemoryRouter>
  )
  // Wait for the SERVED layout (countdowns is not in the client fallback) so
  // interactions never hit the pre-fetch fallback tree, which remounts.
  await waitFor(() => expect(document.querySelector('.today-slot[data-card="countdowns"]')).toBeTruthy())
}

async function enterCustomize() {
  const btn = await screen.findByRole('button', { name: /Customize/i })
  await waitFor(() => expect(btn).toBeEnabled()) // enabled only once the layout GET resolves
  fireEvent.click(btn)
  await screen.findByRole('button', { name: /Save for me/i })
}

// The default shape: a pinned week-calendar band over a row of three columns.
const LAYOUT: StoredLayout = {
  zones: {
    dir: 'col',
    children: [
      { cards: ['weekCalendar'], size: 1 },
      { dir: 'row', children: [{ cards: ['agenda'] }, { cards: ['countdowns'] }, { cards: ['chores'] }] },
    ],
  },
  hidden: [],
}

afterEach(() => vi.restoreAllMocks())

describe('Today customize dividers', () => {
  it('shows zone dividers in the normal view AND in Customize', async () => {
    await renderToday(LAYOUT)
    // Resizers live on the main dashboard now, not just in Customize.
    expect(document.querySelector('.today-divider-h')).toBeTruthy()
    expect(document.querySelectorAll('.today-divider-v').length).toBe(2) // between 3 columns
    await enterCustomize()
    expect(document.querySelector('.today-divider-h')).toBeTruthy()
    expect(document.querySelectorAll('.today-divider-v').length).toBe(2)
  })

  it('resizes the pinned band zone on the normal dashboard (no Customize) and auto-saves', async () => {
    await renderToday(LAYOUT)
    // enough time for the layout GET to resolve so the save carries the served layout
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => String(u).includes('/api/today-layout'))).toBe(true))
    const h = document.querySelector('.today-divider-h') as HTMLElement
    act(() => {
      fireEvent(h, pointer('pointerdown', 500, 400))
      fireEvent(window, pointer('pointermove', 500, 520)) // +120px on a 320px unit → ratio 1.375
      fireEvent(window, pointer('pointerup', 500, 520))
    })
    await waitFor(() => expect(puts().length).toBe(1))
    const body = lastPutBody()
    expect(body.scope).toBe('user')
    expect((body.layout.zones as ZoneSplit).children[0].size).toBeCloseTo(1.375)
  })

  it('rebalances row-split widths on the normal dashboard (no Customize) and auto-saves', async () => {
    await renderToday(LAYOUT)
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => String(u).includes('/api/today-layout'))).toBe(true))
    const v = document.querySelectorAll('.today-divider-v')[0] as HTMLElement
    act(() => {
      fireEvent(v, pointer('pointerdown', 400, 300))
      fireEvent(window, pointer('pointermove', 620, 300)) // +220px ≈ +1 ratio unit
      fireEvent(window, pointer('pointerup', 620, 300))
    })
    await waitFor(() => expect(puts().length).toBe(1))
    const body = lastPutBody()
    expect(body.scope).toBe('user')
    const row = (body.layout.zones as ZoneSplit).children[1] as ZoneSplit
    expect(row.children[0].size).toBe(2) // grew by one unit
    expect(row.children[1].size).toBe(0.25) // shrunk to the floor
    expect(row.children[2].size).toBeUndefined() // untouched
  })

  it('dragging dividers in Customize persists only on "Save for me"', async () => {
    await renderToday(LAYOUT)
    await enterCustomize()
    const h = document.querySelector('.today-divider-h') as HTMLElement
    act(() => {
      fireEvent(h, pointer('pointerdown', 500, 400))
      fireEvent(window, pointer('pointermove', 500, 520))
      fireEvent(window, pointer('pointerup', 500, 520))
    })
    expect(puts().length).toBe(0) // nothing saved yet
    fireEvent.click(screen.getByRole('button', { name: /Save for me/i }))
    await waitFor(() => expect(puts().length).toBe(1))
    expect((lastPutBody().layout.zones as ZoneSplit).children[0].size).toBeCloseTo(1.375)
  })

  it('applying the Classic preset then saving persists that arrangement (no band)', async () => {
    await renderToday(LAYOUT)
    await enterCustomize()
    fireEvent.click(screen.getByRole('button', { name: /Classic columns/i }))
    fireEvent.click(screen.getByRole('button', { name: /Save for me/i }))
    await waitFor(() => expect(puts().length).toBe(1))
    const zones = lastPutBody().layout.zones as ZoneNode
    expect((zones as ZoneSplit).dir).toBe('row') // flat columns, no pinned band
    expect(listLeaves(zones).flatMap((l) => l.leaf.cards)).toContain('weekCalendar')
  })
})

describe('Today zone editor', () => {
  it('splits a zone into side-by-side zones and saves the tree', async () => {
    await renderToday(LAYOUT)
    await enterCustomize()
    // Split the first column (path 1.0) horizontally → a new empty sibling.
    const zone = document.querySelector('[data-region="1.0"]') as HTMLElement
    fireEvent.click(zone.querySelector('[aria-label="Split zone horizontally"]') as HTMLElement)
    await waitFor(() => expect(document.querySelectorAll('[data-region]').length).toBe(5)) // 4 leaves + 1 new
    fireEvent.click(screen.getByRole('button', { name: /Save for me/i }))
    await waitFor(() => expect(puts().length).toBe(1))
    const row = (lastPutBody().layout.zones as ZoneSplit).children[1] as ZoneSplit
    expect(row.children).toHaveLength(4)
  })

  it('deletes a zone, merging its cards into the neighbor', async () => {
    await renderToday(LAYOUT)
    await enterCustomize()
    const zone = document.querySelector('[data-region="1.1"]') as HTMLElement
    fireEvent.click(zone.querySelector('[aria-label="Delete zone"]') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: /Save for me/i }))
    await waitFor(() => expect(puts().length).toBe(1))
    const row = (lastPutBody().layout.zones as ZoneSplit).children[1] as ZoneSplit
    expect(row.children).toHaveLength(2)
    expect((row.children[0] as { cards: string[] }).cards).toEqual(['agenda', 'countdowns'])
  })

  it('disables deleting the last remaining zone', async () => {
    mockAll({ zones: { dir: 'col', children: [{ cards: ['agenda'] }] }, hidden: [] })
    render(
      <MemoryRouter>
        <TopbarSlotProvider>
          <Today />
          <Slot />
        </TopbarSlotProvider>
      </MemoryRouter>
    )
    await waitFor(() => expect(document.querySelector('.today-slot[data-card="agenda"]')).toBeTruthy())
    await enterCustomize()
    const del = document.querySelector('[aria-label="Delete zone"]') as HTMLButtonElement
    expect(del.disabled).toBe(true)
  })
})
