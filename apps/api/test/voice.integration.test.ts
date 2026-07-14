// Voice assistant (fork): /api/voice/transcribe against an in-process
// OpenAI-audio-shaped STT stub, and /api/voice/command with the heuristic
// classifier — table-driven dispatch: timer action, grocery items actually
// added, Home Assistant service call proxied for a PINNED entity only, and
// calendar-ish commands bounced to the capture flow.
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
let sttRequests = 0
let haServiceCalls: Array<{ path: string; body: unknown }> = []

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

// One stub plays both roles: the whisper server (/v1/audio/transcriptions) and
// a Home Assistant instance (/api/config, /api/states, /api/services/...).
function startStub(): Promise<number> {
  return new Promise((resolve) => {
    stub = createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      const path = (req.url ?? '').split('?')[0]
      if (req.method === 'POST' && path === '/v1/audio/transcriptions') {
        sttRequests++
        // Drain the multipart body; canned transcript back.
        req.on('data', () => {})
        req.on('end', () => res.end(JSON.stringify({ text: 'add milk to the grocery list' })))
        return
      }
      const auth = req.headers.authorization
      if (path === '/api/config') {
        if (auth !== 'Bearer ha-token') { res.statusCode = 401; return res.end('{}') }
        return res.end(JSON.stringify({ version: '2026.7', location_name: 'Casa' }))
      }
      if (path === '/api/states') {
        return res.end(JSON.stringify([
          { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen Lights' } },
          { entity_id: 'light.porch', state: 'off', attributes: { friendly_name: 'Porch Light' } },
        ]))
      }
      if (req.method === 'POST' && path.startsWith('/api/services/')) {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          haServiceCalls.push({ path, body: raw ? JSON.parse(raw) : null })
          res.end('[]')
        })
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
    stub.listen(0, '127.0.0.1', () => {
      stubPort = (stub.address() as { port: number }).port
      resolve(stubPort)
    })
  })
}

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16').start()
  const dbUrl = pg.getConnectionUri()
  await runMigrations(dbUrl)
  const port = await startStub()

  process.env.DATABASE_URL = dbUrl
  process.env.LOCAL_JWT_SECRET = SECRET
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  delete process.env.AUTH0_DOMAIN
  delete process.env.ANTHROPIC_API_KEY // heuristic classifier
  delete process.env.OPENAI_API_KEY
  delete process.env.OLLAMA_HOST
  process.env.WHISPER_BASE_URL = `http://127.0.0.1:${port}/v1`

  app = (await import('../src/app')).default
  closePool = (await import('../src/platform/db')).closePool

  const query = (await import('../src/platform/db')).query
  const setup = await call('POST', '/api/auth/setup', undefined, {
    household: { name: 'Sites', timezone: 'America/Chicago' },
    admin: { name: 'Kevin', email: 'kevin@example.com', password: 'ownerpass1' },
  })
  expect(setup.statusCode).toBe(201)
  const sb = JSON.parse(setup.body)
  await query(
    `insert into identities (household_id, person_id, provider, auth0_user_id, email_verified) values ($1,$2,'password','dev|kevin',true)`,
    [sb.household.id, sb.person.id]
  )

  // Smart home on + connected to the stub, with ONLY the kitchen light pinned.
  await call('PATCH', '/api/household/modules', kevin, { smartHome: true })
  await call('PUT', '/api/homeassistant/config', kevin, {
    baseUrl: `http://127.0.0.1:${port}`,
    token: 'ha-token',
    entities: ['light.kitchen'],
  })
}, 60_000)

afterAll(async () => {
  await closePool?.()
  await new Promise<void>((r) => stub?.close(() => r()))
  await pg?.stop()
})

describe('voice transcription', () => {
  it('reports the local STT backend', async () => {
    const res = await call('GET', '/api/voice/status', kevin)
    expect(JSON.parse(res.body)).toEqual({ stt: 'local' })
  })

  it('transcribes a base64 clip via the whisper stub', async () => {
    const res = await call('POST', '/api/voice/transcribe', kevin, {
      audio: Buffer.from('fake-opus-bytes').toString('base64'),
      mimeType: 'audio/webm',
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ transcript: 'add milk to the grocery list' })
    expect(sttRequests).toBe(1)
  })

  it('rejects an empty clip', async () => {
    const res = await call('POST', '/api/voice/transcribe', kevin, { audio: '', mimeType: 'audio/webm' })
    expect(res.statusCode).toBe(400)
  })
})

describe('voice commands (heuristic classifier)', () => {
  it('sets a timer', async () => {
    const res = await call('POST', '/api/voice/command', kevin, { transcript: 'set a timer for 10 minutes' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ kind: 'timer', seconds: 600 })
  })

  it('adds items to the grocery list', async () => {
    const res = await call('POST', '/api/voice/command', kevin, {
      transcript: 'add milk and eggs to the grocery list',
    })
    expect(JSON.parse(res.body)).toMatchObject({ kind: 'grocery', added: ['milk', 'eggs'] })
    const list = JSON.parse((await call('GET', '/api/lists/grocery', kevin)).body)
    const names = list.items.map((i: { name: string }) => i.name)
    expect(names).toContain('milk')
    expect(names).toContain('eggs')
  })

  it('controls a PINNED smart-home device', async () => {
    haServiceCalls = []
    const res = await call('POST', '/api/voice/command', kevin, { transcript: 'turn off the kitchen lights' })
    expect(JSON.parse(res.body)).toMatchObject({ kind: 'ha', entityId: 'light.kitchen' })
    expect(haServiceCalls).toHaveLength(1)
    expect(haServiceCalls[0]).toMatchObject({
      path: '/api/services/light/turn_off',
      body: { entity_id: 'light.kitchen' },
    })
  })

  it('refuses an UNPINNED device', async () => {
    haServiceCalls = []
    const res = await call('POST', '/api/voice/command', kevin, { transcript: 'turn on the porch light' })
    const action = JSON.parse(res.body)
    expect(action.kind).toBe('none')
    expect(haServiceCalls).toHaveLength(0)
  })

  it('bounces calendar-ish commands to the capture flow', async () => {
    const res = await call('POST', '/api/voice/command', kevin, {
      transcript: 'dentist appointment for Wally on Tuesday at 3pm',
    })
    expect(JSON.parse(res.body)).toMatchObject({ kind: 'capture' })
  })
})
