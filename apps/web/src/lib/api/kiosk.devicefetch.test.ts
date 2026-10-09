// deviceFetch retries once on a 401 by re-minting the device token. A wrong PIN /
// lock code is ALSO a 401 (carrying triesLeft) — retrying it re-submits the same
// wrong guess, so every miss burned two of the household's tries.
import { kioskApi, KioskClaimError } from './kiosk'

function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
  const calls: string[] = []
  globalThis.fetch = vi.fn(async (url: string) => {
    calls.push(String(url))
    const { status, body } = handler(String(url))
    return { ok: status < 400, status, json: async () => body, clone() { return this } }
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  localStorage.setItem('waffled.kiosk.deviceSecret', 'test-secret')
  localStorage.setItem('waffled.kiosk.deviceAccess', 'stale-or-fresh')
})

describe('deviceFetch + wrong codes', () => {
  it('submits a wrong lock code once (no token-refresh retry)', async () => {
    const calls = stubFetch((u) =>
      u.includes('/api/kiosk/device/token')
        ? { status: 200, body: { accessToken: 'fresh' } }
        : { status: 401, body: { error: 'Unauthorized', message: 'Incorrect code.', triesLeft: 4 } }
    )
    const err = await kioskApi.unlock('0000').catch((e) => e)
    expect(err).toBeInstanceOf(KioskClaimError)
    expect(err.triesLeft).toBe(4)
    expect(calls.filter((u) => u.includes('/api/kiosk/unlock'))).toHaveLength(1)
    expect(calls.some((u) => u.includes('/device/token'))).toBe(false)
  })

  it('submits a wrong profile PIN once', async () => {
    const calls = stubFetch((u) =>
      u.includes('/api/kiosk/device/token')
        ? { status: 200, body: { accessToken: 'fresh' } }
        : { status: 401, body: { error: 'Unauthorized', message: 'Incorrect PIN.', triesLeft: 4 } }
    )
    await kioskApi.claim('p1', '0000').catch(() => {})
    expect(calls.filter((u) => u.includes('/api/kiosk/profile/p1'))).toHaveLength(1)
  })

  it('still refreshes and retries when the device token itself expired', async () => {
    let first = true
    const calls = stubFetch((u) => {
      if (u.includes('/api/kiosk/device/token')) return { status: 200, body: { accessToken: 'fresh' } }
      if (first) { first = false; return { status: 401, body: { error: 'Unauthorized', message: 'jwt expired' } } }
      return { status: 200, body: { ok: true } }
    })
    await expect(kioskApi.unlock('2468')).resolves.toBeUndefined()
    expect(calls.filter((u) => u.includes('/api/kiosk/unlock'))).toHaveLength(2)
    expect(calls.some((u) => u.includes('/device/token'))).toBe(true)
  })
})
