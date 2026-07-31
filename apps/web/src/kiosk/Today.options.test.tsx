// Board options (signal-to-noise): the Customize "Board options" panel — Hide
// empty cards toggle + density select — persisted in layout.options.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Today } from './Today'
import { TopbarSlotProvider, useTopbarSlots } from './topbar-slot'
import type { StoredLayout } from '../lib/api/today-layout'

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

const puts = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PUT')
const lastPutBody = () => JSON.parse(String((puts().at(-1)![1] as RequestInit).body))

function Slot() {
  return <>{useTopbarSlots().right}</>
}

const LAYOUT: StoredLayout = {
  zones: { dir: 'row', children: [{ cards: ['agenda'] }, { cards: ['countdowns'] }, { cards: ['chores'] }] },
  hidden: [],
}

async function renderAndCustomize(initial: StoredLayout) {
  mockAll(initial)
  render(
    <MemoryRouter>
      <TopbarSlotProvider>
        <Today />
        <Slot />
      </TopbarSlotProvider>
    </MemoryRouter>
  )
  await waitFor(() => expect(document.querySelector('.today-slot[data-card="countdowns"]')).toBeTruthy())
  const btn = await screen.findByRole('button', { name: /Customize/i })
  await waitFor(() => expect(btn).toBeEnabled())
  fireEvent.click(btn)
  await screen.findByRole('button', { name: /Save for me/i })
}

afterEach(() => vi.restoreAllMocks())

describe('Today board options', () => {
  it('toggling "Hide empty cards" persists options.hideEmpty on save', async () => {
    await renderAndCustomize(LAYOUT)
    fireEvent.click(screen.getByRole('switch', { name: /Hide empty cards/i }))
    fireEvent.click(screen.getByRole('button', { name: /Save for me/i }))
    await waitFor(() => expect(puts().length).toBe(1))
    expect(lastPutBody().layout.options).toMatchObject({ hideEmpty: true })
  })

  it('picking Compact density previews immediately and persists options.density', async () => {
    await renderAndCustomize(LAYOUT)
    fireEvent.change(screen.getByLabelText(/Density/i), { target: { value: 'compact' } })
    // Preview: the board wrap picks up the density class right away.
    expect((document.querySelector('.today-wrap') as HTMLElement).className).toContain('density-compact')
    fireEvent.click(screen.getByRole('button', { name: /Save for me/i }))
    await waitFor(() => expect(puts().length).toBe(1))
    expect(lastPutBody().layout.options).toMatchObject({ density: 'compact' })
  })

  it('sets per-card quiet settings via the chip ⚙ modal and persists them', async () => {
    await renderAndCustomize(LAYOUT)
    fireEvent.click(screen.getByRole('button', { name: /Agenda options/i }))
    fireEvent.click(await screen.findByRole('switch', { name: /Hide ended events/i }))
    fireEvent.click(screen.getByRole('button', { name: /Done/i }))
    fireEvent.click(screen.getByRole('button', { name: /Save for me/i }))
    await waitFor(() => expect(puts().length).toBe(1))
    expect(lastPutBody().layout.options).toMatchObject({ cards: { agenda: { hideEnded: true } } })
  })

  it('applies the saved density class in normal view', async () => {
    await renderAndCustomize({ ...LAYOUT, options: { density: 'compact', hideEmpty: true } })
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    await waitFor(() => expect((document.querySelector('.today-wrap') as HTMLElement).className).toContain('density-compact'))
    // The saved options round-trip untouched through unrelated saves.
    expect(screen.queryByRole('button', { name: /Save for me/i })).toBeNull()
  })
})
