// Walmart cart handoff (fork): grocery items → product matches → add-to-cart
// deep link, against an in-process affiliate-API stub (signature not verified)
// with the heuristic (no-LLM) normalizer. Covers matching + scoring, the
// match cache (second run makes zero API hits), quantity parsing into the cart
// URL, the unmatched fallback, confirm-pinning, and the unconfigured 501.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { createServer, type Server } from 'node:http'
import { generateKeyPairSync } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { runMigrations } from '../src/migrate'

const SECRET = 'waffled-local-dev-secret-change-me'

let pg: StartedPostgreSqlContainer
let stub: Server
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any
let closePool: () => Promise<void>
let searchCalls: string[] = []

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

const CATALOG: Record<string, Array<{ itemId: string; name: string; salePrice: number; thumbnailImage: string }>> = {
  'chicken thighs': [
    { itemId: '111', name: 'Boneless Skinless Chicken Thighs, 2 lb', salePrice: 6.48, thumbnailImage: 'http://img/chicken.jpg' },
  ],
  milk: [
    { itemId: '222', name: 'Whole Milk, 1 Gallon', salePrice: 3.18, thumbnailImage: 'http://img/milk.jpg' },
    { itemId: '223', name: 'Chocolate Milk Mix', salePrice: 4.5, thumbnailImage: 'http://img/mix.jpg' },
  ],
  'black beans': [
    { itemId: '333', name: 'Black Beans, 15 oz Can', salePrice: 0.98, thumbnailImage: 'http://img/beans.jpg' },
  ],
}

function startStub(): Promise<number> {
  return new Promise((resolve) => {
    stub = createServer((req, res) => {
      const u = new URL(req.url ?? '', 'http://stub')
      res.setHeader('content-type', 'application/json')
      if (u.pathname === '/api-proxy/service/affil/product/v2/search') {
        const q = (u.searchParams.get('query') ?? '').toLowerCase()
        searchCalls.push(q)
        const hit = Object.keys(CATALOG).find((k) => q.includes(k))
        return res.end(JSON.stringify({ items: hit ? CATALOG[hit] : [] }))
      }
      res.statusCode = 404
      res.end('{}')
    })
    stub.listen(0, '127.0.0.1', () => resolve((stub.address() as { port: number }).port))
  })
}

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16').start()
  const dbUrl = pg.getConnectionUri()
  await runMigrations(dbUrl)
  const port = await startStub()

  process.env.DATABASE_URL = dbUrl
  process.env.LOCAL_JWT_SECRET = SECRET
  delete process.env.AUTH0_DOMAIN
  delete process.env.ANTHROPIC_API_KEY // force the heuristic normalizer
  delete process.env.OPENAI_API_KEY
  delete process.env.OLLAMA_HOST
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  process.env.WALMART_CONSUMER_ID = 'consumer-abc'
  process.env.WALMART_PRIVATE_KEY = Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  ).toString('base64')
  process.env.WALMART_API_BASE = `http://127.0.0.1:${port}`

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

  // A grocery list: two matchable items (one with a count quantity), one dud.
  await call('POST', '/api/lists/grocery/items', kevin, { name: '2 lbs chicken thighs' })
  await call('POST', '/api/lists/grocery/items', kevin, { name: 'black beans', quantity: '×3' })
  await call('POST', '/api/lists/grocery/items', kevin, { name: 'grandma’s secret spice blend' })
  // A checked item must be ignored entirely.
  const milk = JSON.parse((await call('POST', '/api/lists/grocery/items', kevin, { name: 'milk' })).body).item
  await call('PATCH', `/api/list-items/${milk.id}`, kevin, { checked: true })
}, 60_000)

afterAll(async () => {
  await closePool?.()
  await new Promise<void>((r) => stub?.close(() => r()))
  await pg?.stop()
})

describe('walmart handoff', () => {
  it('reports configured', async () => {
    const res = await call('GET', '/api/shopping/walmart/status', kevin)
    expect(JSON.parse(res.body)).toEqual({ configured: true })
  })

  it('matches unchecked items, normalizes queries, and builds the cart link', async () => {
    const res = await call('POST', '/api/shopping/walmart/match', kevin, {})
    expect(res.statusCode).toBe(200)
    const r = JSON.parse(res.body)

    expect(r.matched).toHaveLength(2)
    const chicken = r.matched.find((m: { name: string }) => m.name.includes('chicken'))
    expect(chicken).toMatchObject({ walmartItemId: '111', quantity: 1 }) // "2 lbs" is a weight, not a count
    const beans = r.matched.find((m: { name: string }) => m.name === 'black beans')
    expect(beans).toMatchObject({ walmartItemId: '333', quantity: 3 })

    // The heuristic stripped "2 lbs" before searching.
    expect(searchCalls.some((q) => q.startsWith('chicken'))).toBe(true)

    expect(r.unmatched).toHaveLength(1)
    expect(r.unmatched[0].name).toContain('spice blend')

    // checked milk was never considered
    expect(r.matched.find((m: { name: string }) => m.name === 'milk')).toBeUndefined()
    expect(r.cartUrl).toBe('https://affil.walmart.com/cart/addToCart?items=111,333_3')
  })

  it('serves repeat matches from the cache (no new API hits)', async () => {
    const before = searchCalls.length
    const res = await call('POST', '/api/shopping/walmart/match', kevin, {})
    const r = JSON.parse(res.body)
    expect(r.matched).toHaveLength(2)
    // Only the unmatched dud is retried; cached items don't re-search.
    expect(searchCalls.length - before).toBe(1)
  })

  it('confirm pins a match', async () => {
    const res = await call('POST', '/api/shopping/walmart/confirm', kevin, {
      itemName: 'black beans', walmartItemId: '333',
    })
    expect(res.statusCode).toBe(200)
    const again = JSON.parse((await call('POST', '/api/shopping/walmart/match', kevin, {})).body)
    expect(again.matched.find((m: { name: string }) => m.name === 'black beans').confirmed).toBe(true)
  })

  it('404s a confirm for an unknown item', async () => {
    const res = await call('POST', '/api/shopping/walmart/confirm', kevin, {
      itemName: 'never seen this', walmartItemId: '999',
    })
    expect(res.statusCode).toBe(404)
  })

})
