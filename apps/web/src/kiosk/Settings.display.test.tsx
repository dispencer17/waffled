// Settings → Family: the household "Event style" select (Solid default,
// Tinted opt-out) PATCHes /api/household/display.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Settings } from './Settings'

const HOUSEHOLD = { id: 'h', name: 'Home', timezone: 'UTC', weekStart: 'sunday', location: null, ownerPersonId: 'me', settings: {} }
const KEVIN = { id: 'me', name: 'Kevin', memberType: 'adult', isAdmin: true, isOwner: true, hasLogin: true, hasPin: false, avatarEmoji: '🐻', colorHex: '#2F7FED', capabilities: [] }

function mockAll() {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/api/household/settings')) return { ok: true, json: async () => ({ household: HOUSEHOLD, members: [KEVIN] }) }
    if (u.includes('/api/permissions')) return { ok: false, status: 403, json: async () => ({}) } // PermissionsCard hides itself
    if (u.includes('/api/household/display')) return { ok: true, json: async () => ({ display: JSON.parse(String(init?.body ?? '{}')) }) }
    if (u.includes('/api/household')) return { ok: true, json: async () => ({ provisioned: true, household: HOUSEHOLD, person: KEVIN, memberships: [] }) }
    return { ok: true, json: async () => ({ persons: [], members: [], roles: [], caps: [], devices: [], feeds: [], calendars: [] }) }
  }) as unknown as typeof fetch
}

describe('Settings — Event style', () => {
  it('shows the select on the Family tab defaulting to Solid, and saves Tinted', async () => {
    mockAll()
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Settings />
      </MemoryRouter>
    )
    expect(await screen.findByText('Event style')).toBeInTheDocument()
    const sel = screen.getByDisplayValue('Solid colors') as HTMLSelectElement
    fireEvent.change(sel, { target: { value: 'tinted' } })
    await waitFor(() => {
      const patches = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([u, init]) => String(u).includes('/api/household/display') && (init as RequestInit)?.method === 'PATCH'
      )
      expect(patches.length).toBe(1)
      expect(JSON.parse(String((patches[0][1] as RequestInit).body))).toEqual({ eventStyle: 'tinted' })
    })
  })
})
