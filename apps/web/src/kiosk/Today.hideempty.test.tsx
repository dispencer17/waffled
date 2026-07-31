// Hide-empty board option: cards that report "nothing to show" collapse away
// in view mode, stay visible without the option, and always show in Customize.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Today } from './Today'
import { TopbarSlotProvider, useTopbarSlots } from './topbar-slot'
import type { StoredLayout } from '../lib/api/today-layout'

const MODULES = { pantry: false, familyNight: false, goals: false, smartHome: false, chores: true, meals: false, lists: false, quotes: false }
// Every data fetch resolves empty, so agenda/chores/countdowns all report empty.
const EMPTY = { persons: [], items: [], lists: [], people: [], instances: [], entries: [], events: [], goals: [], photos: [], recipes: [], currencies: [], countdowns: [], upForGrabs: 0 }

function mockAll(initial: StoredLayout) {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/today-layout')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { layout: StoredLayout }
        return { ok: true, json: async () => ({ ok: true, layout: body.layout }) }
      }
      return { ok: true, json: async () => ({ resolved: initial, family: initial, user: null, source: 'family', cards: [], canEditFamily: false }) }
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

function Slot() {
  return <>{useTopbarSlots().right}</>
}

const ZONES: StoredLayout['zones'] = { dir: 'row', children: [{ cards: ['agenda'] }, { cards: ['countdowns'] }, { cards: ['chores'] }] }

async function renderToday(layout: StoredLayout) {
  mockAll(layout)
  render(
    <MemoryRouter>
      <TopbarSlotProvider>
        <Today />
        <Slot />
      </TopbarSlotProvider>
    </MemoryRouter>
  )
  await waitFor(() => expect(document.querySelector('.today-slot[data-card="countdowns"]')).toBeTruthy())
}

const slotOf = (card: string) => document.querySelector(`.today-slot[data-card="${card}"]`) as HTMLElement

afterEach(() => vi.restoreAllMocks())

describe('Today hide-empty cards', () => {
  it('collapses cards that report empty when the option is on', async () => {
    await renderToday({ zones: ZONES, hidden: [], options: { hideEmpty: true } })
    await waitFor(() => expect(slotOf('agenda').className).toContain('today-slot--collapsed'))
    await waitFor(() => expect(slotOf('chores').className).toContain('today-slot--collapsed'))
  })

  it('keeps empty cards visible when the option is off', async () => {
    await renderToday({ zones: ZONES, hidden: [] })
    // Give the empty reports time to land, then confirm nothing collapsed.
    await screen.findByText(/Nothing on the calendar today/)
    expect(slotOf('agenda').className).not.toContain('today-slot--collapsed')
    expect(slotOf('chores').className).not.toContain('today-slot--collapsed')
  })

  it('shows every card again in Customize', async () => {
    await renderToday({ zones: ZONES, hidden: [], options: { hideEmpty: true } })
    await waitFor(() => expect(slotOf('agenda').className).toContain('today-slot--collapsed'))
    const btn = await screen.findByRole('button', { name: /Customize/i })
    await waitFor(() => expect(btn).toBeEnabled())
    fireEvent.click(btn)
    await screen.findByRole('button', { name: /Save for me/i })
    // Edit mode renders compact chips for every placed card — nothing hidden.
    expect(document.querySelector('.today-card-wrap[data-card="agenda"]')).toBeTruthy()
    expect(document.querySelector('.today-card-wrap[data-card="chores"]')).toBeTruthy()
  })
})
