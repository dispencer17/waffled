// EventStyleSync stamps the household's event-style setting onto the document
// root so pure CSS switches every chip between solid (default) and tinted.
import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventStyleSync } from './EventStyleSync'

function mockHousehold(settings: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/household')) {
      return {
        ok: true,
        json: async () => ({
          provisioned: true,
          household: { id: 'h', name: 'Home', timezone: 'UTC', weekStart: 'sunday', settings },
          person: { id: 'me', name: 'Kevin', memberType: 'adult', isAdmin: true, capabilities: [] },
        }),
      }
    }
    return { ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
}

afterEach(() => document.documentElement.removeAttribute('data-ev-style'))

describe('EventStyleSync', () => {
  it('stamps solid by default (setting absent)', async () => {
    mockHousehold({})
    render(<EventStyleSync />)
    await waitFor(() => expect(document.documentElement.getAttribute('data-ev-style')).toBe('solid'))
  })

  it('stamps tinted when the household picked the soft look', async () => {
    mockHousehold({ display: { eventStyle: 'tinted' } })
    render(<EventStyleSync />)
    await waitFor(() => expect(document.documentElement.getAttribute('data-ev-style')).toBe('tinted'))
  })
})
