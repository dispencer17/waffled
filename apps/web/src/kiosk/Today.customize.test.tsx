// Customize mode: draggable zone dividers (band height + column widths) that are
// visible only while customizing and persist with "Save for me".
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Today } from './Today'
import { TopbarSlotProvider, useTopbarSlots } from './topbar-slot'

const MODULES = { pantry: false, familyNight: false, goals: false, smartHome: false, chores: true, meals: false, lists: false, quotes: false }
const EMPTY = { persons: [], items: [], lists: [], people: [], instances: [], entries: [], events: [], goals: [], photos: [], recipes: [], currencies: [] }
type Layout = { full: string[]; cols: string[][]; hidden: string[]; bandHeight?: number; colWidths?: number[] }

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

async function renderToday(initial: Layout) {
  mockAll(initial)
  render(
    <MemoryRouter>
      <TopbarSlotProvider>
        <Today />
        <Slot />
      </TopbarSlotProvider>
    </MemoryRouter>
  )
  await waitFor(() => expect(document.querySelector('.today-slot[data-card="agenda"]')).toBeTruthy())
}

async function enterCustomize() {
  const btn = await screen.findByRole('button', { name: /Customize/i })
  await waitFor(() => expect(btn).toBeEnabled()) // enabled only once the layout GET resolves
  fireEvent.click(btn)
  await screen.findByRole('button', { name: /Save for me/i })
}

const LAYOUT: Layout = { full: ['weekCalendar'], cols: [['agenda'], ['countdowns'], ['chores']], hidden: [] }

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

  it('resizes the band on the normal dashboard (no Customize) and auto-saves', async () => {
    await renderToday(LAYOUT)
    // enough time for the layout GET to resolve so the save carries the served layout
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => String(u).includes('/api/today-layout'))).toBe(true))
    const h = document.querySelector('.today-divider-h') as HTMLElement
    act(() => {
      fireEvent(h, pointer('pointerdown', 500, 400))
      fireEvent(window, pointer('pointermove', 500, 520)) // +120 from a 320 default → 440
      fireEvent(window, pointer('pointerup', 500, 520))
    })
    await waitFor(() => expect(puts().length).toBe(1))
    const body = lastPutBody()
    expect(body.scope).toBe('user')
    expect(body.layout.bandHeight).toBe(440)
  })

  it('resizes columns on the normal dashboard (no Customize) and auto-saves', async () => {
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
    expect(body.layout.colWidths).toEqual([2, 0.4, 1])
  })

  it('dragging the horizontal divider then saving persists a clamped bandHeight', async () => {
    await renderToday(LAYOUT)
    await enterCustomize()
    const h = document.querySelector('.today-divider-h') as HTMLElement
    act(() => {
      fireEvent(h, pointer('pointerdown', 500, 400))
      fireEvent(window, pointer('pointermove', 500, 520)) // +120 from a 320 default → 440
      fireEvent(window, pointer('pointerup', 500, 520))
    })
    fireEvent.click(screen.getByRole('button', { name: /Save for me/i }))
    await waitFor(() => expect(puts().length).toBe(1))
    expect(lastPutBody().layout.bandHeight).toBe(440)
  })

  it('dragging a vertical divider then saving persists clamped colWidths', async () => {
    await renderToday(LAYOUT)
    await enterCustomize()
    const v = document.querySelectorAll('.today-divider-v')[0] as HTMLElement // between col 0 and 1
    act(() => {
      fireEvent(v, pointer('pointerdown', 400, 300))
      fireEvent(window, pointer('pointermove', 620, 300)) // +220px ≈ +1 ratio unit
      fireEvent(window, pointer('pointerup', 620, 300))
    })
    fireEvent.click(screen.getByRole('button', { name: /Save for me/i }))
    await waitFor(() => expect(puts().length).toBe(1))
    // col0 grows to 2, col1 shrinks to the 0.4 floor, col2 unchanged.
    expect(lastPutBody().layout.colWidths).toEqual([2, 0.4, 1])
  })

  it('applying the Classic preset then saving persists that arrangement (no band)', async () => {
    await renderToday(LAYOUT)
    await enterCustomize()
    fireEvent.click(screen.getByRole('button', { name: /Classic columns/i }))
    fireEvent.click(screen.getByRole('button', { name: /Save for me/i }))
    await waitFor(() => expect(puts().length).toBe(1))
    const body = lastPutBody()
    expect(body.layout.full).toEqual([])
    expect(body.layout.cols.flat()).toContain('weekCalendar')
  })
})
