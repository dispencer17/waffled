// Household display settings (settings.display) — today just eventStyle:
// 'solid' (default, maximum color) vs 'tinted' (the soft wash). Admin-only,
// merged into the settings jsonb without clobbering sibling keys (modules).
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
let wallyToken = ''

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

  // A non-admin member for the 403 case.
  const wally = JSON.parse((await call('POST', '/api/persons', kevin, { name: 'Wally', memberType: 'adult' })).body).person.id
  expect((await call('PUT', `/api/persons/${wally}/login`, kevin, { email: 'wally@example.com', password: 'wallypass1' })).statusCode).toBe(200)
  wallyToken = JSON.parse((await call('POST', '/api/auth/login', undefined, { email: 'wally@example.com', password: 'wallypass1' })).body).accessToken
}, 120_000)

afterAll(async () => {
  await closePool?.()
  await pg?.stop()
})

describe('PATCH /api/household/display', () => {
  it('persists eventStyle in settings.display without clobbering sibling settings', async () => {
    // Seed a sibling settings key first (modules) so the merge is observable.
    expect((await call('PATCH', '/api/household/modules', kevin, { pantry: true })).statusCode).toBe(200)

    const r = await call('PATCH', '/api/household/display', kevin, { eventStyle: 'tinted' })
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).display).toEqual({ eventStyle: 'tinted' })

    const h = JSON.parse((await call('GET', '/api/household', kevin)).body).household
    expect(h.settings?.display?.eventStyle).toBe('tinted')
    expect(h.settings?.modules?.pantry).toBe(true) // sibling survived the jsonb merge

    // Flip back to solid (the default look).
    const back = await call('PATCH', '/api/household/display', kevin, { eventStyle: 'solid' })
    expect(back.statusCode).toBe(200)
    expect(JSON.parse(back.body).display).toEqual({ eventStyle: 'solid' })
  })

  it('persists weekCard alongside eventStyle without clobbering it', async () => {
    expect((await call('PATCH', '/api/household/display', kevin, { eventStyle: 'solid' })).statusCode).toBe(200)
    const r = await call('PATCH', '/api/household/display', kevin, { weekCard: 'plain' })
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).display).toEqual({ eventStyle: 'solid', weekCard: 'plain' })

    const h = JSON.parse((await call('GET', '/api/household', kevin)).body).household
    expect(h.settings?.display?.weekCard).toBe('plain')
    expect(h.settings?.display?.eventStyle).toBe('solid') // sibling survived the merge

    // Flip back to separated (the default look).
    const back = await call('PATCH', '/api/household/display', kevin, { weekCard: 'separated' })
    expect(back.statusCode).toBe(200)
    expect(JSON.parse(back.body).display.weekCard).toBe('separated')
  })

  it('persists familyColorHex (whole-family event color) and validates the hex', async () => {
    const r = await call('PATCH', '/api/household/display', kevin, { familyColorHex: '#E0A500' })
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).display.familyColorHex).toBe('#E0A500')

    const h = JSON.parse((await call('GET', '/api/household', kevin)).body).household
    expect(h.settings?.display?.familyColorHex).toBe('#E0A500')
    expect(h.settings?.display?.weekCard).toBe('separated') // sibling survived the merge

    // Only #RRGGBB is accepted.
    expect((await call('PATCH', '/api/household/display', kevin, { familyColorHex: 'gold' })).statusCode).toBe(400)
    expect((await call('PATCH', '/api/household/display', kevin, { familyColorHex: '#FFF' })).statusCode).toBe(400)
    expect((await call('PATCH', '/api/household/display', kevin, { familyColorHex: '#GGGGGG' })).statusCode).toBe(400)
  })

  it('rejects unknown values and empty patches', async () => {
    expect((await call('PATCH', '/api/household/display', kevin, { eventStyle: 'plaid' })).statusCode).toBe(400)
    expect((await call('PATCH', '/api/household/display', kevin, { weekCard: 'zigzag' })).statusCode).toBe(400)
    expect((await call('PATCH', '/api/household/display', kevin, {})).statusCode).toBe(400)
    expect((await call('PATCH', '/api/household/display', kevin, { bogus: true })).statusCode).toBe(400)
  })

  it('is admin-only', async () => {
    expect((await call('PATCH', '/api/household/display', wallyToken, { eventStyle: 'tinted' })).statusCode).toBe(403)
  })
})
