// Today-layout routes — the exact regression class this guards: a card key the
// kiosk registry can place (smartHome bit us) missing from TODAY_CARDS makes
// every save of a layout containing it 400. Drives the real HTTP routes against
// a throwaway Postgres, mirroring the other integration suites.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from './helpers/pg'
import { runMigrations } from '../src/migrate'

const SECRET = 'waffled-local-dev-secret-change-me'

let pg: StartedPostgreSqlContainer
let url: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any
let closePool: () => Promise<void>

interface RunResult { statusCode: number; body: string }

function call(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  return app.run(
    { httpMethod: method, path, headers, queryStringParameters: {}, body: body !== undefined ? JSON.stringify(body) : null, isBase64Encoded: false },
    {}
  ) as Promise<RunResult>
}

let kevin = ''

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16').start()
  url = pg.getConnectionUri()
  await runMigrations(url)
  process.env.DATABASE_URL = url
  process.env.LOCAL_JWT_SECRET = SECRET
  delete process.env.AUTH0_DOMAIN
  app = (await import('../src/app')).default
  closePool = (await import('../src/platform/db')).closePool

  const setup = await call('POST', '/api/auth/setup', undefined, {
    household: { name: 'Sites', timezone: 'America/Chicago' },
    admin: { name: 'Kevin', email: 'kevin@example.com', password: 'ownerpass1' },
  })
  expect(setup.statusCode).toBe(201)
  kevin = JSON.parse(setup.body).accessToken
}, 120_000)

afterAll(async () => {
  await closePool?.()
  await pg?.stop()
})

// All leaves of a zone tree, pre-order — the assertion workhorse.
function leaves(root: { cards?: string[]; children?: unknown[] }): { cards: string[]; size?: number }[] {
  if (root.cards) return [root as { cards: string[]; size?: number }]
  return ((root.children ?? []) as { cards?: string[]; children?: unknown[] }[]).flatMap(leaves)
}

describe('today-layout routes', () => {
  it('accepts and round-trips a legacy columns layout placing weekCalendar and smartHome', async () => {
    const cols = [['weekCalendar', 'agenda', 'countdowns'], ['tonight', 'week', 'smartHome'], ['chores', 'grocery']]
    const put = await call('PUT', '/api/today-layout', kevin, { scope: 'user', layout: { cols, hidden: [] } })
    expect(put.statusCode).toBe(200)
    const saved = JSON.parse(put.body).layout
    expect(leaves(saved.zones)[0].cards).toEqual(['weekCalendar', 'agenda', 'countdowns'])
    expect(leaves(saved.zones)[1].cards).toContain('smartHome')

    const get = await call('GET', '/api/today-layout', kevin)
    expect(get.statusCode).toBe(200)
    const resolved = JSON.parse(get.body).resolved
    expect(leaves(resolved.zones)[0].cards).toEqual(['weekCalendar', 'agenda', 'countdowns'])
    expect(leaves(resolved.zones).flatMap((l) => l.cards)).toContain('smartHome')
  })

  it('gives an unplaced weekCalendar its own top band zone for layouts saved before it existed', async () => {
    const put = await call('PUT', '/api/today-layout', kevin, { scope: 'user', layout: { cols: [['agenda'], ['tonight'], ['chores']], hidden: [] } })
    expect(put.statusCode).toBe(200)
    expect(leaves(JSON.parse(put.body).layout.zones)[0].cards).toEqual(['weekCalendar'])
  })

  it('converts a legacy {full, cols, bandHeight, colWidths} layout into sized zones', async () => {
    const layout = {
      full: ['weekCalendar'],
      cols: [['agenda', 'countdowns'], ['tonight', 'week'], ['chores', 'grocery']],
      hidden: [],
      bandHeight: 5000, // px → ratio, clamped to 4
      colWidths: [2, 1, 1],
    }
    const put = await call('PUT', '/api/today-layout', kevin, { scope: 'user', layout })
    expect(put.statusCode).toBe(200)
    const saved = JSON.parse(put.body).layout
    const ls = leaves(saved.zones)
    expect(ls[0].cards).toEqual(['weekCalendar'])
    expect(ls[0].size).toBe(4)
    expect(ls[1].size).toBe(2)

    const resolved = JSON.parse((await call('GET', '/api/today-layout', kevin)).body).resolved
    expect(leaves(resolved.zones)[0].cards).toEqual(['weekCalendar'])
    expect(leaves(resolved.zones)[1].size).toBe(2)
  })

  it('still 400s a layout with an unknown card key', async () => {
    const r = await call('PUT', '/api/today-layout', kevin, { scope: 'user', layout: { cols: [['agenda', 'bogus'], [], []], hidden: [] } })
    expect(r.statusCode).toBe(400)
  })

  // --- v2 zone trees ------------------------------------------------------

  it('round-trips a v2 zones layout with board options, storing zones-native', async () => {
    const layout = {
      zones: {
        dir: 'row',
        children: [
          { cards: ['agenda', 'grocery'], size: 2 },
          { dir: 'col', children: [{ cards: ['weekCalendar'] }, { cards: ['chores', 'tonight', 'week', 'countdowns', 'rewards', 'pantry', 'familyNight', 'goals', 'smartHome'] }] },
        ],
      },
      hidden: [],
      options: { hideEmpty: true, density: 'compact' },
    }
    const put = await call('PUT', '/api/today-layout', kevin, { scope: 'user', layout })
    expect(put.statusCode).toBe(200)
    const saved = JSON.parse(put.body).layout
    expect(saved.zones.children[0].cards).toEqual(['agenda', 'grocery'])
    expect(saved.zones.children[0].size).toBe(2)
    expect(saved.options).toEqual({ hideEmpty: true, density: 'compact' })

    const get = await call('GET', '/api/today-layout', kevin)
    const resolved = JSON.parse(get.body).resolved
    expect(resolved.zones.children[0].cards).toEqual(['agenda', 'grocery'])
    expect(resolved.options).toEqual({ hideEmpty: true, density: 'compact' })
    // The raw stored user tier is zones-native (no legacy full/cols keys).
    const user = JSON.parse(get.body).user
    expect(user.zones).toBeTruthy()
    expect(user.full).toBeUndefined()
  })

  it('rewrites a legacy PUT as zones on save', async () => {
    const put = await call('PUT', '/api/today-layout', kevin, {
      scope: 'user',
      layout: { full: ['weekCalendar'], cols: [['agenda', 'countdowns'], ['tonight', 'week'], ['chores', 'grocery', 'rewards', 'pantry', 'familyNight', 'goals', 'smartHome']], hidden: [] },
    })
    expect(put.statusCode).toBe(200)
    const get = await call('GET', '/api/today-layout', kevin)
    const body = JSON.parse(get.body)
    expect(body.user.zones).toBeTruthy() // stored zones-native after the save
    expect(body.user.full).toBeUndefined()
    expect(leaves(body.resolved.zones)[0].cards).toEqual(['weekCalendar'])
    expect(leaves(body.resolved.zones)[1].cards).toEqual(['agenda', 'countdowns'])
  })

  it('400s a v2 tree containing an unknown card key', async () => {
    const r = await call('PUT', '/api/today-layout', kevin, {
      scope: 'user',
      layout: { zones: { dir: 'row', children: [{ cards: ['agenda', 'bogus'] }] }, hidden: [] },
    })
    expect(r.statusCode).toBe(400)
  })
})
