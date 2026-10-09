import { render, screen, fireEvent, act } from '@testing-library/react'
import { KioskLock } from './KioskLock'

const { unlock, ClaimError } = vi.hoisted(() => {
  class ClaimError extends Error {
    constructor(public status: number, message: string, public opts: { triesLeft?: number; retryAfter?: number } = {}) {
      super(message)
      Object.assign(this, opts)
    }
  }
  return { unlock: vi.fn(), ClaimError }
})
vi.mock('../lib/api', () => ({ KioskClaimError: ClaimError, kioskApi: { unlock: (code: string) => unlock(code) } }))
const reject = (status: number, opts: { triesLeft?: number; retryAfter?: number }) =>
  unlock.mockImplementation(async () => { throw new ClaimError(status, 'nope', opts) })

const shield = () => screen.queryByLabelText(/tablet is locked/i)
const lockBtn = () => screen.queryByRole('button', { name: /lock the tablet/i })
async function typeCode(code: string) {
  for (const d of code) fireEvent.click(screen.getByRole('button', { name: d }))
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

// mockClear, not mockReset: under vitest 2.1 a reset mock's later async throw is
// reported as a test error even when the component catches it.
beforeEach(() => { unlock.mockClear(); unlock.mockImplementation(async () => undefined) })

describe('KioskLock', () => {
  it('starts locked; a tap opens the keypad and the right code unlocks', async () => {
    unlock.mockResolvedValue(undefined)
    render(<KioskLock idleMinutes={3} screensaverUp={false} />)
    expect(shield()).not.toBeNull()
    expect(lockBtn()).toBeNull()

    fireEvent.click(shield()!)
    expect(screen.getByText(/enter the lock code/i)).toBeTruthy()
    await typeCode('2468') // auto-submits on the 4th digit
    expect(unlock).toHaveBeenCalledWith('2468')
    expect(shield()).toBeNull()
    expect(lockBtn()).not.toBeNull()
  })

  it('shows tries left on a wrong code and stays locked', async () => {
    reject(401, { triesLeft: 2 })
    render(<KioskLock idleMinutes={3} screensaverUp={false} />)
    fireEvent.click(shield()!)
    await typeCode('0000')
    expect(screen.getByText(/2 tries left/i)).toBeTruthy()
    expect(shield()).not.toBeNull()
  })

  it('shows the lockout wait on a 429', async () => {
    reject(429, { retryAfter: 30 })
    render(<KioskLock idleMinutes={3} screensaverUp={false} />)
    fireEvent.click(shield()!)
    await typeCode('0000')
    expect(screen.getByText(/try again in 30s/i)).toBeTruthy()
  })

  it('cancel closes the keypad but stays locked', () => {
    render(<KioskLock idleMinutes={3} screensaverUp={false} />)
    fireEvent.click(shield()!)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByText(/enter the lock code/i)).toBeNull()
    expect(shield()).not.toBeNull()
  })

  it('swallows key presses while locked', () => {
    const onKey = vi.fn()
    window.addEventListener('keydown', onKey)
    try {
      render(<KioskLock idleMinutes={3} screensaverUp={false} />)
      fireEvent.keyDown(document.body, { key: 'a' })
      expect(onKey).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onKey)
    }
  })

  it('re-locks after the idle timeout, and the lock button locks at once', async () => {
    vi.useFakeTimers()
    try {
      unlock.mockResolvedValue(undefined)
      render(<KioskLock idleMinutes={2} screensaverUp={false} />)
      fireEvent.click(shield()!)
      await typeCode('2468')
      expect(shield()).toBeNull()

      act(() => { vi.advanceTimersByTime(60_000) })
      fireEvent.pointerDown(window) // activity resets the idle clock
      act(() => { vi.advanceTimersByTime(90_000) })
      expect(shield()).toBeNull()
      act(() => { vi.advanceTimersByTime(31_000) })
      expect(shield()).not.toBeNull()

      fireEvent.click(shield()!)
      await typeCode('2468')
      fireEvent.click(lockBtn()!)
      expect(shield()).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('locks when the screensaver comes up', async () => {
    unlock.mockResolvedValue(undefined)
    const { rerender } = render(<KioskLock idleMinutes={30} screensaverUp={false} />)
    fireEvent.click(shield()!)
    await typeCode('2468')
    expect(shield()).toBeNull()
    rerender(<KioskLock idleMinutes={30} screensaverUp={true} />)
    expect(shield()).not.toBeNull()
  })
})
