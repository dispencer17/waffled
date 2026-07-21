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

describe('today-layout routes', () => {
  it('accepts and round-trips a layout placing weekCalendar and smartHome', async () => {
    const cols = [['weekCalendar', 'agenda', 'countdowns'], ['tonight', 'week', 'smartHome'], ['chores', 'grocery']]
    const put = await call('PUT', '/api/today-layout', kevin, { scope: 'user', layout: { cols, hidden: [] } })
    expect(put.statusCode).toBe(200)
    const saved = JSON.parse(put.body).layout
    expect(saved.cols[0]).toEqual(['weekCalendar', 'agenda', 'countdowns'])
    expect(saved.cols[1]).toContain('smartHome')

    const get = await call('GET', '/api/today-layout', kevin)
    expect(get.statusCode).toBe(200)
    const resolved = JSON.parse(get.body).resolved
    expect(resolved.cols[0]).toEqual(['weekCalendar', 'agenda', 'countdowns'])
    expect(resolved.cols.flat()).toContain('smartHome')
  })

  it('surfaces weekCalendar via the missing-append pass for layouts saved before it existed', async () => {
    const put = await call('PUT', '/api/today-layout', kevin, { scope: 'user', layout: { cols: [['agenda'], ['tonight'], ['chores']], hidden: [] } })
    expect(put.statusCode).toBe(200)
    // The reconciled layout appends unplaced, unhidden cards to the last column.
    expect(JSON.parse(put.body).layout.cols[2]).toContain('weekCalendar')
  })

  it('still 400s a layout with an unknown card key', async () => {
    const r = await call('PUT', '/api/today-layout', kevin, { scope: 'user', layout: { cols: [['agenda', 'bogus'], [], []], hidden: [] } })
    expect(r.statusCode).toBe(400)
  })
})
