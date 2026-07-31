// Today dashboard layout — client slice + hook. Two tiers: a family default
// and a per-person override; the API returns the resolved zone tree plus which
// tier it came from. See modules/layout/today-layout.ts on the server.
import { useEffect, useState } from 'react'
import { apiGet, apiSend, apiDelete } from './client'
import type { ZoneNode } from '../../kiosk/zone-layout'

export type LayoutScope = 'user' | 'family'

// Board signal-to-noise options, stored alongside the layout (same user-over-
// family tiering). `cards` holds per-card quiet settings.
export interface BoardOptions {
  hideEmpty?: boolean
  density?: 'cozy' | 'compact'
  cards?: {
    agenda?: { hideEnded?: boolean }
    grocery?: { maxItems?: number }
    chores?: { hideOpen?: boolean }
  }
}

// A normalized layout: the FancyZones-style zone tree (recursive row/col splits
// whose leaves hold ordered card stacks), the cards the user explicitly hid
// from Today, and the board options. `hidden` is what lets a removed card
// (esp. a module card that would otherwise auto-reappear) stay gone until the
// user shows it again.
export interface StoredLayout {
  zones: ZoneNode
  hidden: string[]
  options?: BoardOptions
}

export interface TodayLayoutResponse {
  resolved: StoredLayout
  family: unknown
  user: unknown
  source: LayoutScope | 'default'
  cards: string[]
  canEditFamily: boolean
}

export const todayLayoutApi = {
  get: () => apiGet<TodayLayoutResponse>('/api/today-layout'),
  save: (scope: LayoutScope, layout: StoredLayout) =>
    apiSend<{ ok: boolean; layout: StoredLayout }>('PUT', '/api/today-layout', { scope, layout }),
  reset: (scope: LayoutScope) => apiDelete(`/api/today-layout?scope=${scope}`),
}

export interface TodayLayoutState {
  resolved: StoredLayout
  source: LayoutScope | 'default'
  canEditFamily: boolean
  loading: boolean
  error: boolean
  save: (scope: LayoutScope, layout: StoredLayout) => Promise<void>
  reset: (scope: LayoutScope) => Promise<void>
  refetch: () => void
}

const FALLBACK: StoredLayout = {
  zones: {
    dir: 'col',
    children: [
      { cards: ['weekCalendar'], size: 1 },
      { dir: 'row', children: [{ cards: ['agenda'] }, { cards: ['tonight', 'week'] }, { cards: ['chores', 'grocery'] }] },
    ],
  },
  hidden: [],
}

export function useTodayLayout(): TodayLayoutState {
  const [data, setData] = useState<TodayLayoutResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    todayLayoutApi
      .get()
      .then((d) => alive && (setData(d), setError(false), setLoading(false)))
      .catch(() => alive && (setError(true), setLoading(false)))
    return () => {
      alive = false
    }
  }, [nonce])

  const refetch = () => setNonce((n) => n + 1)

  async function save(scope: LayoutScope, layout: StoredLayout): Promise<void> {
    const r = await todayLayoutApi.save(scope, layout)
    // Reflect the saved (server-reconciled) layout immediately.
    setData((d) =>
      d
        ? { ...d, [scope]: r.layout, resolved: scope === 'user' || d.user == null ? r.layout : d.resolved, source: scope }
        : d
    )
    refetch()
  }

  async function reset(scope: LayoutScope): Promise<void> {
    await todayLayoutApi.reset(scope)
    refetch()
  }

  return {
    // Guard the deploy window: an API that predates zones serves the legacy
    // {full, cols} shape — fall back to the default board rather than crash.
    resolved: data?.resolved?.zones ? data.resolved : FALLBACK,
    source: data?.source ?? 'default',
    canEditFamily: data?.canEditFamily ?? false,
    loading,
    error,
    save,
    reset,
    refetch,
  }
}
