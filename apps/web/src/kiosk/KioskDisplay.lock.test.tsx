import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { KioskDisplay } from './KioskDisplay'

// The lock only mounts on a paired kiosk with the lock enabled AND a code set.
const mode = { kiosk: true }
const lock = { enabled: true, idleMinutes: 3, hasCode: true }
vi.mock('../lib/api', () => ({
  isDisplayMode: () => true,
  isKioskMode: () => mode.kiosk,
  clearProfileSession: vi.fn(),
  KioskClaimError: class extends Error {},
  kioskApi: {
    unlock: vi.fn(),
    displayConfig: vi.fn(async () => ({
      screensaverMinutes: 15,
      resetHomeMinutes: 0,
      content: 'clock',
      returnToPicker: true,
      nightDim: { enabled: false, start: '22:00', end: '07:00' },
      lock: { ...lock },
    })),
  },
  useWeather: () => null,
  useEventsToday: () => ({ events: [] }),
  usePhotos: () => ({ photos: [] }),
  useHousehold: () => ({ household: { timezone: 'America/Chicago' } }),
}))

async function mount() {
  render(
    <MemoryRouter>
      <KioskDisplay><div>app</div></KioskDisplay>
    </MemoryRouter>
  )
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const shield = () => screen.queryByLabelText(/tablet is locked/i)

afterEach(() => { mode.kiosk = true; Object.assign(lock, { enabled: true, hasCode: true }) })

describe('KioskDisplay lock screen', () => {
  it('locks a paired kiosk when the lock is on and a code is set', async () => {
    await mount()
    expect(shield()).not.toBeNull()
  })

  it('stays unlocked when no code is set', async () => {
    lock.hasCode = false
    await mount()
    expect(shield()).toBeNull()
  })

  it('stays unlocked when the lock is off', async () => {
    lock.enabled = false
    await mount()
    expect(shield()).toBeNull()
  })

  it('never locks a non-kiosk display browser', async () => {
    mode.kiosk = false
    await mount()
    expect(shield()).toBeNull()
  })
})
