// Smart Home (Home Assistant): module gating, config persistence (token
// encrypted at rest), live status probe, pinned-entity allowlist filtering, and
// service-call enforcement — against a real Postgres (Testcontainers) and an
// in-process HA stub.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { runMigrations } from '../src/migrate'

const SECRET = 'waffled-local-dev-secret-change-me'

let pg: StartedPostgreSqlContainer
let stub: Server
let stubPort = 0
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any
let closePool: () => Promise<void>
let householdId = ''
// What the stub saw, for asserting proxied service calls.
let serviceCalls: Array<{ path: string; auth: string | null; body: unknown }> = []

function mint(sub: string): string {
  return jwt.sign({}, SECRET, { algorithm: 'HS256', subject: sub, issuer: 'waffled-local', audience: 'waffled-api', expiresIn: '1h' })
}

function call(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  return app.run(
    { httpMethod: method, path, headers, queryStringParameters: {}, body: body !== undefined ? JSON.stringify(body) : null, isBase64Encoded: false },
    {}
  ) as Promise<{ statusCode: number; body: string }>
}

const kevin = mint('dev|kevin')

const STATES = [
  { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen Lights' } },
  { entity_id: 'light.porch', state: 'off', attributes: { friendly_name: 'Porch Light' } },
  { entity_id: 'switch.coffee', state: 'off', attributes: { friendly_name: 'Coffee Maker' } },
  { entity_id: 'sensor.humidity', state: '41', attributes: { friendly_name: 'Humidity' } },
]

function startStub(): Promise<number> {
  return new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      const auth = req.headers.authorization ?? null
      if (auth !== 'Bearer ha-test-token') {
        res.statusCode = 401
        return res.end('{"message":"unauthorized"}')
      }
      if (req.method === 'GET' && req.url === '/api/config') {
        return res.end(JSON.stringify({ version: '2026.7.1', location_name: 'Casa' }))
      }
      if (req.method === 'GET' && req.url === '/api/states') {
        return res.end(JSON.stringify(STATES))
      }
      if (req.method === 'POST' && req.url?.startsWith('/api/services/')) {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          serviceCalls.push({ path: req.url!, auth, body: raw ? JSON.parse(raw) : null })
          res.end('[]')
        })
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
    stub.listen(0, '127.0.0.1', () => resolve((stub.address() as { port: number }).port))
  })
}

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16').start()
  const url = pg.getConnectionUri()
  await runMigrations(url)
  stubPort = await startStub()
  process.env.DATABASE_URL = url
  process.env.LOCAL_JWT_SECRET = SECRET
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  delete process.env.AUTH0_DOMAIN
  app = (await import('../src/app')).default
  closePool = (await import('../src/platform/db')).closePool

  const setup = await call('POST', '/api/auth/setup', undefined, {
    household: { name: 'Sites', timezone: 'America/Chicago' },
    admin: { name: 'Kevin', email: 'kevin@example.com', password: 'ownerpass1' },
  })
  householdId = JSON.parse(setup.body).household.id
  const ownerId = JSON.parse(setup.body).person.id
  const { query } = await import('../src/platform/db')
  await query(
    `insert into identities (household_id, person_id, provider, auth0_user_id, email_verified) values ($1,$2,'password','dev|kevin',true)`,
    [householdId, ownerId]
  )
}, 60_000)

afterAll(async () => {
  await closePool?.()
  await new Promise<void>((r) => stub?.close(() => r()))
  await pg?.stop()
})

describe('smart home (home assistant)', () => {
  it('is gated off by default (403)', async () => {
    expect((await call('GET', '/api/homeassistant/status', kevin)).statusCode).toBe(403)
  })

  it('enables the module', async () => {
    expect((await call('PATCH', '/api/household/modules', kevin, { smartHome: true })).statusCode).toBe(200)
  })

  it('reports unconfigured before a connection is saved', async () => {
    const res = await call('GET', '/api/homeassistant/status', kevin)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ configured: false, entities: [] })
  })

  it('saves the connection and probes it (token encrypted at rest, never echoed)', async () => {
    const res = await call('PUT', '/api/homeassistant/config', kevin, {
      baseUrl: `http://127.0.0.1:${stubPort}`,
      token: 'ha-test-token',
    })
    expect(res.statusCode).toBe(200)
    const s = JSON.parse(res.body)
    expect(s).toMatchObject({ configured: true, connected: true, locationName: 'Casa', version: '2026.7.1' })
    expect(JSON.stringify(s)).not.toContain('ha-test-token')

    const { query } = await import('../src/platform/db')
    const { rows } = await query<{ settings: { homeAssistant?: { tokenEncrypted?: string } } }>(
      `select settings from households where id = $1`,
      [householdId]
    )
    const stored = rows[0].settings.homeAssistant?.tokenEncrypted
    expect(stored).toBeTruthy()
    expect(stored).not.toContain('ha-test-token') // encrypted, not plaintext

    const cfg = await call('GET', '/api/homeassistant/config', kevin)
    expect(JSON.parse(cfg.body)).toMatchObject({ hasToken: true })
    expect(cfg.body).not.toContain('ha-test-token')
  })

  it('rejects a non-http base URL', async () => {
    const res = await call('PUT', '/api/homeassistant/config', kevin, { baseUrl: 'ftp://nope' })
    expect(res.statusCode).toBe(400)
  })

  it('lists every entity for the admin picker', async () => {
    const res = await call('GET', '/api/homeassistant/entities/all', kevin)
    expect(res.statusCode).toBe(200)
    const { entities } = JSON.parse(res.body)
    expect(entities).toHaveLength(4)
    expect(entities.map((e: { entityId: string }) => e.entityId)).toContain('sensor.humidity')
  })

  it('quick-controls only see pinned entities, in pin order', async () => {
    await call('PUT', '/api/homeassistant/config', kevin, { entities: ['switch.coffee', 'light.kitchen'] })
    const res = await call('GET', '/api/homeassistant/entities', kevin)
    expect(res.statusCode).toBe(200)
    const { entities } = JSON.parse(res.body)
    expect(entities.map((e: { entityId: string }) => e.entityId)).toEqual(['switch.coffee', 'light.kitchen'])
    expect(entities[1]).toMatchObject({ name: 'Kitchen Lights', domain: 'light', state: 'on' })
  })

  it('proxies a service call for a pinned entity', async () => {
    serviceCalls = []
    const res = await call('POST', '/api/homeassistant/service', kevin, {
      domain: 'light', service: 'toggle', entityId: 'light.kitchen',
    })
    expect(res.statusCode).toBe(200)
    expect(serviceCalls).toHaveLength(1)
    expect(serviceCalls[0]).toMatchObject({
      path: '/api/services/light/toggle',
      auth: 'Bearer ha-test-token',
      body: { entity_id: 'light.kitchen' },
    })
  })

  it('refuses a service call for an unpinned entity (403)', async () => {
    serviceCalls = []
    const res = await call('POST', '/api/homeassistant/service', kevin, {
      domain: 'light', service: 'toggle', entityId: 'light.porch',
    })
    expect(res.statusCode).toBe(403)
    expect(serviceCalls).toHaveLength(0)
  })

  it('rejects malformed domain/service names', async () => {
    const res = await call('POST', '/api/homeassistant/service', kevin, {
      domain: 'light/../../evil', service: 'toggle', entityId: 'light.kitchen',
    })
    expect(res.statusCode).toBe(400)
  })
})
