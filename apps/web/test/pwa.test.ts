import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), '../public/sw.js')

async function loadWorker() {
  const source = await readFile(workerPath, 'utf8')
  const listeners = new Map<string, (event: unknown) => void>()
  const cacheStorage = {
    open: vi.fn(async () => ({ put: vi.fn(), match: vi.fn(async () => undefined) })),
    keys: vi.fn(async () => ['waffled-v1-shell', 'waffled-v1-assets', 'waffled-v1-api']),
    delete: vi.fn(async () => true),
    match: vi.fn(async () => undefined),
  }
  const self = {
    location: { origin: 'https://waffled.test' },
    clients: { claim: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener)
    },
  }
  runInNewContext(source, {
    self,
    caches: cacheStorage,
    fetch: vi.fn(async () => new Response('{}', { status: 200 })),
    URL,
    Response,
    Set,
  })
  return { listeners, cacheStorage }
}

describe('service worker request privacy', () => {
  it('does not intercept or cache authenticated API reads', async () => {
    const { listeners } = await loadWorker()
    const respondWith = vi.fn()

    listeners.get('fetch')?.({
      request: {
        method: 'GET',
        mode: 'cors',
        url: 'https://waffled.test/api/household',
        headers: { authorization: 'Bearer private-session' },
      },
      respondWith,
    })

    expect(respondWith).not.toHaveBeenCalled()
  })

  it('deletes an API cache left by an older worker', async () => {
    const { listeners, cacheStorage } = await loadWorker()
    let activation: Promise<unknown> | undefined

    listeners.get('activate')?.({
      waitUntil: (promise: Promise<unknown>) => {
        activation = promise
      },
    })
    await activation

    expect(cacheStorage.delete).toHaveBeenCalledWith('waffled-v1-api')
  })

  it('serves /media/ through the stale-while-revalidate cache', async () => {
    const { listeners, cacheStorage } = await loadWorker()
    const respondWith = vi.fn()

    listeners.get('fetch')?.({
      request: { method: 'GET', mode: 'no-cors', url: 'https://waffled.test/media/photos/abc.webp' },
      respondWith,
    })

    expect(respondWith).toHaveBeenCalledOnce()
    await respondWith.mock.calls[0][0] // the SWR promise resolves without throwing
    expect(cacheStorage.open).toHaveBeenCalledWith('waffled-v2-media')
  })
})

describe('web app manifest (Android install)', () => {
  it('is installable on phones: any orientation, id, and shortcuts', async () => {
    const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), '../public/manifest.webmanifest')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(manifest.orientation).toBe('any') // phones are portrait; kiosk CSS handles landscape
    expect(manifest.id).toBeTruthy()
    expect(manifest.display).toBe('standalone')
    expect(manifest.shortcuts?.length).toBeGreaterThan(0)
    // Maskable icon required for a proper Android launcher icon.
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
  })

  it('ships an assetlinks.json for the TWA', async () => {
    const p = resolve(dirname(fileURLToPath(import.meta.url)), '../public/.well-known/assetlinks.json')
    const links = JSON.parse(await readFile(p, 'utf8'))
    expect(links[0].target.package_name).toBe('app.waffled.twa')
  })
})
