import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { RewardsCard } from './RewardsCard'

// The Today rewards card: every member's star balance at a glance, a pending-
// approvals note for parents, and a jump into the Reward Shop.

function mockRewards() {
  globalThis.fetch = vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/balances'))
      return {
        ok: true,
        json: async () => ({
          currencies: [{ key: 'stars', label: 'Stars', emoji: '⭐' }],
          people: [
            { personId: 'p1', name: 'Wally', avatarEmoji: '🐢', colorHex: '#25A368', stars: 12, balances: [], recent: [] },
            { personId: 'p2', name: 'Lottie', avatarEmoji: '🦊', colorHex: '#EC6049', stars: 5, balances: [], recent: [] },
          ],
        }),
      }
    if (u.includes('/api/redemptions'))
      return { ok: true, json: async () => ({ redemptions: [{ id: 'r1', status: 'pending', title: 'Movie night' }] }) }
    if (u.includes('/api/rewards')) return { ok: true, json: async () => ({ rewards: [] }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

describe('RewardsCard', () => {
  it('shows each member with their star balance and the pending count', async () => {
    mockRewards()
    render(
      <MemoryRouter>
        <RewardsCard />
      </MemoryRouter>
    )
    expect(await screen.findByText('Wally')).toBeInTheDocument()
    expect(screen.getByText('Lottie')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText(/1 waiting for approval/)).toBeInTheDocument()
  })

  it('jumps to the Reward Shop', async () => {
    mockRewards()
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RewardsCard />} />
          <Route path="/tasks" element={<div>SHOP PAGE</div>} />
        </Routes>
      </MemoryRouter>
    )
    fireEvent.click(await screen.findByRole('button', { name: /Shop/ }))
    expect(await screen.findByText('SHOP PAGE')).toBeInTheDocument()
  })
})
