// In-app update button (fork): admin gating on the request, shared-token auth on
// the agent route, and exactly-once claiming. Hermetic — UPDATE_CHECK_REPO stays
// unset so the notifier half never calls GitHub.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from './helpers/pg'
import { Client } from 'pg'
import jwt from 'jsonwebtoken'
import { runMigrations } from '../src/migrate'

const SECRET = 'waffled-local-dev-secret-change-me'
const TOKEN = 'a'.repeat(64)

let pg: StartedPostgreSqlContainer
let url: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any
let closePool: () => Promise<void>

function mint(sub: string): string {
  return jwt.sign({}, SECRET, { algorithm: 'HS256', subject: sub, issuer: 'waffled-local', audience: 'waffled-api', expiresIn: '1h' })
}
interface RunResult { statusCode: number; body: string }
function call(method: string, path: string, opts: { token?: string; agent?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  if (opts.agent) headers['x-waffled-update-token'] = opts.agent
  return app.run(
    { httpMethod: method, path, headers, queryStringParameters: {}, body: opts.body ? JSON.stringify(opts.body) : null, isBase64Encoded: false },
    {}
  ) as Promise<RunResult>
}
const admin = mint('dev|kevin')
const kid = mint('dev|kid')

async function resetState() {
  const c = new Client({ connectionString: url })
  await c.connect()
  await c.query(`update update_state set status='idle', requested_at=null, requested_by=null,
                 claimed_at=null, finished_at=null, exit_code=null, message=null,
                 agent_seen_at=null, behind_count=0 where id = true`)
  await c.end()
}

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16').start()
  url = pg.getConnectionUri()
  await runMigrations(url)
  process.env.DATABASE_URL = url
  delete process.env.AUTH0_DOMAIN
  delete process.env.UPDATE_CHECK_REPO // keep hermetic — no outbound call
  process.env.UPDATE_AGENT_TOKEN = TOKEN
  app = (await import('../src/app')).default
  closePool = (await import('../src/platform/db')).closePool

  const client = new Client({ connectionString: url })
  await client.connect()
  const hh = await client.query<{ id: string }>(`insert into households (name, timezone) values ('H','UTC') returning id`)
  const hid = hh.rows[0].id
  const adm = await client.query<{ id: string }>(
    `insert into persons (household_id, name, member_type, is_admin) values ($1,'Adm','adult',true) returning id`, [hid])
  await client.query(
    `insert into identities (household_id, person_id, provider, auth0_user_id, email_verified) values ($1,$2,'password','dev|kevin',true)`, [hid, adm.rows[0].id])
  const k = await client.query<{ id: string }>(
    `insert into persons (household_id, name, member_type, is_admin) values ($1,'Kid','kid',false) returning id`, [hid])
  await client.query(
    `insert into identities (household_id, person_id, provider, auth0_user_id, email_verified) values ($1,$2,'password','dev|kid',true)`, [hid, k.rows[0].id])
  await client.end()
})

afterAll(async () => {
  delete process.env.UPDATE_AGENT_TOKEN
  await closePool?.()
  await pg?.stop()
})

describe('POST /api/updates/request', () => {
  it('queues for an admin', async () => {
    await resetState()
    const r = await call('POST', '/api/updates/request', { token: admin })
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).update.status).toBe('queued')
  })

  it('rejects a non-admin', async () => {
    await resetState()
    const r = await call('POST', '/api/updates/request', { token: kid })
    expect(r.statusCode).toBe(403)
  })

  it('is idempotent — a double press does not re-queue', async () => {
    await resetState()
    await call('POST', '/api/updates/request', { token: admin })
    const first = JSON.parse((await call('POST', '/api/updates/agent-poll', { agent: TOKEN, body: { behind: 2 } })).body)
    expect(first.pending).toBe(true) // claimed → running
    const again = await call('POST', '/api/updates/request', { token: admin })
    expect(JSON.parse(again.body).update.status).toBe('running') // NOT re-queued
  })
})

describe('POST /api/updates/agent-poll', () => {
  it('rejects a missing or wrong token', async () => {
    await resetState()
    expect((await call('POST', '/api/updates/agent-poll', { body: { behind: 0 } })).statusCode).toBe(401)
    expect((await call('POST', '/api/updates/agent-poll', { agent: 'b'.repeat(64), body: { behind: 0 } })).statusCode).toBe(401)
  })

  it('claims a queued request exactly once', async () => {
    await resetState()
    await call('POST', '/api/updates/request', { token: admin })
    const one = JSON.parse((await call('POST', '/api/updates/agent-poll', { agent: TOKEN, body: { behind: 3 } })).body)
    const two = JSON.parse((await call('POST', '/api/updates/agent-poll', { agent: TOKEN, body: { behind: 3 } })).body)
    expect(one.pending).toBe(true)
    expect(two.pending).toBe(false)
    expect(two.update.status).toBe('running')
  })

  it('records success and failure', async () => {
    await resetState()
    await call('POST', '/api/updates/request', { token: admin })
    await call('POST', '/api/updates/agent-poll', { agent: TOKEN, body: { behind: 1 } })
    const ok = JSON.parse((await call('POST', '/api/updates/agent-poll', { agent: TOKEN, body: { behind: 0, result: { exitCode: 0, message: 'done' } } })).body)
    expect(ok.update.status).toBe('idle')

    await call('POST', '/api/updates/request', { token: admin })
    await call('POST', '/api/updates/agent-poll', { agent: TOKEN, body: { behind: 1 } })
    const bad = JSON.parse((await call('POST', '/api/updates/agent-poll', { agent: TOKEN, body: { behind: 1, result: { exitCode: 1, message: 'dirty tree' } } })).body)
    expect(bad.update.status).toBe('failed')
    expect(bad.update.message).toBe('dirty tree')
  })

  it('reports agent liveness through GET /api/updates', async () => {
    await resetState()
    const before = JSON.parse((await call('GET', '/api/updates', { token: admin })).body)
    expect(before.update.agentDown).toBe(true) // never seen
    await call('POST', '/api/updates/agent-poll', { agent: TOKEN, body: { behind: 4 } })
    const after = JSON.parse((await call('GET', '/api/updates', { token: admin })).body)
    expect(after.update.agentDown).toBe(false)
    expect(after.update.behindCount).toBe(4)
  })
})
