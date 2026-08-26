# In-App Update Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-gated "Update now" button in the web app that deploys the fork's latest CI-tested `main` to the live stack, with the nightly auto-update task suspended on rollout.

**Architecture:** The API container cannot rebuild its own host (no Docker socket, no git), so the request direction is inverted: the button writes a flag to a single-row Postgres table, and a host Scheduled Task polls the API every 60s, claims the flag, and runs the existing `update.ps1`. Success is detected client-side by the existing `build-watch.ts` bundle-hash comparison, so no API round trip is needed while the stack restarts.

**Tech Stack:** TypeScript (lambda-api, node-pg-migrate, vitest + testcontainers), React 18, PowerShell 5.1, Docker Compose.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-26-update-button-design.md`.
- Migration number **must** be the next free one (`0103`); never reuse a number (`apps/api/CLAUDE.md`).
- Web UI **must** use existing design-system classes (`.btn .btn-primary`, `.set-card`) — never raw HTML controls (`apps/web/CLAUDE.md`).
- Fork rule: add fork options **inside** upstream's containers; do not rearrange upstream's Settings nav. Mark divergences with a `// fork` comment.
- Agent header name is exactly `x-waffled-update-token`.
- Task names are exactly `"Waffled Fork Update"` (nightly, being suspended) and `"Waffled Fork Update Agent"` (new).
- `UPDATE_CHECK_ENABLED` / `settings.updateCheck.enabled` gate the **outbound GitHub call only** — they must never disable the button.
- One PR, one commit per task. TDD: failing test first, always.

---

### Task 1: Update-state table and derivation

**Files:**
- Create: `apps/api/migrations/0103_update_state.sql`
- Create: `apps/api/src/modules/updates/update-state.ts`
- Test: `apps/api/test/update-state.unit.test.ts`

**Interfaces:**
- Consumes: `query` from `../../platform/db`.
- Produces: `type UpdateStatus = 'idle'|'queued'|'running'|'failed'`; `interface UpdateStateRow`; `interface DerivedUpdate extends UpdateStateRow { agentDown: boolean; stuck: boolean }`; `derive(row: UpdateStateRow, now: number): DerivedUpdate`; `readState(): Promise<UpdateStateRow>`; `requestUpdate(personId: string): Promise<UpdateStateRow>`; `agentPoll(behind: number, result?: { exitCode: number; message: string }): Promise<{ state: UpdateStateRow; pending: boolean }>`; constants `AGENT_STALE_MS = 600000`, `STUCK_MS = 1800000`.

- [ ] **Step 1: Write the failing unit test**

```ts
// apps/api/test/update-state.unit.test.ts
import { describe, it, expect } from 'vitest'
import { derive, AGENT_STALE_MS, STUCK_MS, type UpdateStateRow } from '../src/modules/updates/update-state'

const NOW = Date.parse('2026-08-26T12:00:00Z')
const base: UpdateStateRow = {
  status: 'idle', requestedAt: null, claimedAt: null, finishedAt: null,
  exitCode: null, message: null, agentSeenAt: new Date(NOW - 1000).toISOString(), behindCount: 0,
}

describe('derive', () => {
  it('reports a live agent as up', () => {
    expect(derive(base, NOW).agentDown).toBe(false)
  })
  it('reports a never-seen agent as down', () => {
    expect(derive({ ...base, agentSeenAt: null }, NOW).agentDown).toBe(true)
  })
  it('reports a silent agent as down past the stale window', () => {
    const old = new Date(NOW - AGENT_STALE_MS - 1000).toISOString()
    expect(derive({ ...base, agentSeenAt: old }, NOW).agentDown).toBe(true)
  })
  it('is not stuck while running inside the window', () => {
    const row: UpdateStateRow = { ...base, status: 'running', claimedAt: new Date(NOW - 60_000).toISOString() }
    expect(derive(row, NOW).stuck).toBe(false)
  })
  it('is stuck once running past the limit', () => {
    const row: UpdateStateRow = { ...base, status: 'running', claimedAt: new Date(NOW - STUCK_MS - 1000).toISOString() }
    expect(derive(row, NOW).stuck).toBe(true)
  })
  it('is never stuck when not running', () => {
    const row: UpdateStateRow = { ...base, status: 'queued', claimedAt: new Date(NOW - STUCK_MS - 1000).toISOString() }
    expect(derive(row, NOW).stuck).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/api && npx vitest run test/update-state.unit.test.ts`
Expected: FAIL — cannot resolve `../src/modules/updates/update-state`.

- [ ] **Step 3: Write the migration**

```sql
-- apps/api/migrations/0103_update_state.sql
-- Up Migration
-- Single-row server state for the in-app update button. Server-wide, NOT per
-- household: an update rebuilds the whole stack, so two households cannot
-- meaningfully disagree about it.
create table if not exists update_state (
  id            boolean primary key default true check (id),
  status        text not null default 'idle'
                check (status in ('idle', 'queued', 'running', 'failed')),
  requested_at  timestamptz,
  requested_by  uuid references persons(id) on delete set null,
  claimed_at    timestamptz,
  finished_at   timestamptz,
  exit_code     integer,
  message       text,
  agent_seen_at timestamptz,
  behind_count  integer not null default 0
);
insert into update_state (id) values (true) on conflict (id) do nothing;

-- Down Migration
drop table if exists update_state;
```

- [ ] **Step 4: Write the state module**

```ts
// apps/api/src/modules/updates/update-state.ts
// Server-wide state for the in-app update button (fork). The API cannot rebuild
// its own host, so this table is a mailbox: the button queues, the host agent
// claims and reports back. See docs/superpowers/specs/2026-08-26-update-button-design.md
import { query } from '../../platform/db'

export type UpdateStatus = 'idle' | 'queued' | 'running' | 'failed'

export interface UpdateStateRow {
  status: UpdateStatus
  requestedAt: string | null
  claimedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  message: string | null
  agentSeenAt: string | null
  behindCount: number
}

export interface DerivedUpdate extends UpdateStateRow {
  agentDown: boolean
  stuck: boolean
}

/** No agent contact within this window → the host task isn't running. */
export const AGENT_STALE_MS = 10 * 60_000
/** Claimed but still not finished after this → the rebuild wedged. */
export const STUCK_MS = 30 * 60_000

// Derived, never stored — storing a "down" flag would need a writer that is
// itself the thing that's down.
export function derive(row: UpdateStateRow, now: number): DerivedUpdate {
  const seen = row.agentSeenAt ? Date.parse(row.agentSeenAt) : null
  const claimed = row.claimedAt ? Date.parse(row.claimedAt) : null
  return {
    ...row,
    agentDown: seen === null || now - seen > AGENT_STALE_MS,
    stuck: row.status === 'running' && claimed !== null && now - claimed > STUCK_MS,
  }
}

interface DbRow {
  status: UpdateStatus
  requested_at: Date | null
  claimed_at: Date | null
  finished_at: Date | null
  exit_code: number | null
  message: string | null
  agent_seen_at: Date | null
  behind_count: number
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

function toRow(r: DbRow): UpdateStateRow {
  return {
    status: r.status,
    requestedAt: iso(r.requested_at),
    claimedAt: iso(r.claimed_at),
    finishedAt: iso(r.finished_at),
    exitCode: r.exit_code,
    message: r.message,
    agentSeenAt: iso(r.agent_seen_at),
    behindCount: r.behind_count,
  }
}

const COLS = `status, requested_at, claimed_at, finished_at, exit_code, message, agent_seen_at, behind_count`

export async function readState(): Promise<UpdateStateRow> {
  const { rows } = await query<DbRow>(`select ${COLS} from update_state where id = true`)
  return toRow(rows[0])
}

// Idempotent by construction: the WHERE clause matches nothing when a run is
// already queued or in flight, so a double-press cannot queue twice.
export async function requestUpdate(personId: string): Promise<UpdateStateRow> {
  await query(
    `update update_state
        set status = 'queued', requested_at = now(), requested_by = $1,
            claimed_at = null, finished_at = null, exit_code = null, message = null
      where id = true and status in ('idle', 'failed')`,
    [personId]
  )
  return readState()
}

// One statement, one row lock: `for update` in the CTE serializes concurrent
// pollers, and comparing against the PREVIOUS status is what makes the claim
// exactly-once when a slow rebuild overlaps the next poll.
export async function agentPoll(
  behind: number,
  result?: { exitCode: number; message: string }
): Promise<{ state: UpdateStateRow; pending: boolean }> {
  if (result) {
    const { rows } = await query<DbRow>(
      `update update_state
          set agent_seen_at = now(), behind_count = $1,
              status = case when $2 = 0 then 'idle' else 'failed' end,
              finished_at = now(), exit_code = $2, message = $3
        where id = true
        returning ${COLS}`,
      [behind, result.exitCode, result.message]
    )
    return { state: toRow(rows[0]), pending: false }
  }
  const { rows } = await query<DbRow & { prev_status: UpdateStatus }>(
    `with prev as (select status from update_state where id = true for update)
     update update_state u
        set agent_seen_at = now(), behind_count = $1,
            status = case when prev.status = 'queued' then 'running' else u.status end,
            claimed_at = case when prev.status = 'queued' then now() else u.claimed_at end
       from prev
      where u.id = true
      returning prev.status as prev_status, ${COLS.split(', ').map((c) => `u.${c}`).join(', ')}`,
    [behind]
  )
  return { state: toRow(rows[0]), pending: rows[0].prev_status === 'queued' }
}
```

- [ ] **Step 5: Run the unit test and confirm it passes**

Run: `cd apps/api && npx vitest run test/update-state.unit.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Verify migration hygiene**

Run: `cd apps/api && npm run check:migrations`
Expected: no collision reported for `0103`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/migrations/0103_update_state.sql apps/api/src/modules/updates/update-state.ts apps/api/test/update-state.unit.test.ts
git commit -m "feat(api): update-state table and liveness derivation for the update button"
```

---

### Task 2: Agent token plumbing

**Files:**
- Modify: `waffled` (secret generation block, ~line 106 and the verification loop ~line 114)
- Modify: `infra/compose/docker-compose.yml` (api `environment:`, near `UPDATE_CHECK_REPO`)
- Modify: `infra/compose/.env.example` (near line 152)

**Interfaces:**
- Produces: env var `UPDATE_AGENT_TOKEN` present in `infra/compose/.env` and in the api container.

There is no automated test for shell secret generation in this repo; verification is the explicit command in Step 3.

- [ ] **Step 1: Generate the token in `./waffled`**

In the `openssl` block, after the `TOKEN_ENCRYPTION_KEY` line, add:

```sh
    [ -n "$(env_val UPDATE_AGENT_TOKEN)" ] || set_env_var UPDATE_AGENT_TOKEN "$(openssl rand -hex 32 | tr -d '\n')"
```

Hex, not base64: the host agent reads this straight out of `.env` and puts it in an HTTP header, and base64's `+`/`/` invite quoting bugs in PowerShell for no benefit.

Do **not** add it to the `for secret in …` hard-failure loop — an existing install that hasn't re-run `./waffled up` should degrade to "button unavailable", not refuse to boot.

- [ ] **Step 2: Pass it to the api container**

In `infra/compose/docker-compose.yml`, directly below the `UPDATE_CHECK_REPO` line:

```yaml
      # Shared secret for the host update agent (fork). Generated by ./waffled up.
      # Unset → POST /api/updates/agent-poll returns 503 and the button stays hidden.
      UPDATE_AGENT_TOKEN: ${UPDATE_AGENT_TOKEN:-}
```

And document it in `infra/compose/.env.example` near `UPDATE_CHECK_REPO`:

```sh
# Shared secret the host "Waffled Fork Update Agent" task uses to claim update
# requests. Generated automatically by ./waffled up; no need to set it by hand.
# UPDATE_AGENT_TOKEN=
```

- [ ] **Step 3: Verify generation and injection**

Run: `bash ./waffled up` then `grep -c '^UPDATE_AGENT_TOKEN=' infra/compose/.env`
Expected: `1`, with a 64-character hex value.

Run: `docker exec waffled-api printenv UPDATE_AGENT_TOKEN`
Expected: the same value.

- [ ] **Step 4: Commit**

```bash
git add waffled infra/compose/docker-compose.yml infra/compose/.env.example
git commit -m "feat(infra): generate UPDATE_AGENT_TOKEN for the host update agent"
```

---

### Task 3: API routes

**Files:**
- Modify: `apps/api/src/modules/updates/updates.ts`
- Modify: `apps/api/src/app.ts` (`PUBLIC_PATHS`, ~line 105)
- Modify: `apps/api/src/platform/rate-limit.ts` (`routeLimits`, ~line 108)
- Test: `apps/api/test/update-button.integration.test.ts`

**Interfaces:**
- Consumes: `derive`, `readState`, `requestUpdate`, `agentPoll` from Task 1; `adminRoute` from `../../platform/route-guards`.
- Produces: `POST /api/updates/request` → `{ update: DerivedUpdate }`; `POST /api/updates/agent-poll` → `{ pending: boolean, update: DerivedUpdate }`; `GET /api/updates` gains `update: DerivedUpdate`.

- [ ] **Step 1: Write the failing integration test**

```ts
// apps/api/test/update-button.integration.test.ts
// In-app update button: admin gating on the request, shared-token auth on the
// agent route, and exactly-once claiming. Hermetic — no outbound calls.
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
  delete process.env.UPDATE_CHECK_REPO
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/api && npx vitest run test/update-button.integration.test.ts`
Expected: FAIL — 404s, because the routes don't exist yet.

- [ ] **Step 3: Make the agent route public and rate-limited**

In `apps/api/src/app.ts`, add to `PUBLIC_PATHS` (with a comment matching the file's style):

```ts
  // The host update agent is a Scheduled Task with no session; it authenticates
  // with the UPDATE_AGENT_TOKEN shared secret inside the handler instead.
  '/api/updates/agent-poll',
```

In `apps/api/src/platform/rate-limit.ts`, add a case to `routeLimits` before `default:`:

```ts
    case 'POST /api/updates/agent-poll':
      return [{
        scope: 'update-agent-poll', key: ip,
        max: positiveInt('RATE_LIMIT_UPDATE_AGENT_MAX', 60), windowMs: 5 * 60_000,
      }]
```

The real agent polls 5x per 5 minutes, so 60 is roomy for it while making token guessing pointless. This matters precisely *because* the path is public.

- [ ] **Step 4: Add the routes**

In `apps/api/src/modules/updates/updates.ts`, add imports at the top:

```ts
import { timingSafeEqual } from 'node:crypto'
import type { Request } from 'lambda-api'
import { derive, readState, requestUpdate, agentPoll } from './update-state'
```

Add the token helpers above `registerUpdateRoutes`:

```ts
// The host agent's shared secret (generated into infra/compose/.env by ./waffled up).
// Unset → the agent route is closed entirely; the button degrades to unavailable
// rather than becoming an unauthenticated way to queue rebuilds.
const agentToken = (): string => (process.env.UPDATE_AGENT_TOKEN || '').trim()

function agentAuthorized(req: Request): boolean {
  const expected = agentToken()
  if (!expected) return false
  const got = String(req.headers['x-waffled-update-token'] ?? '')
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false // length alone is not secret
  return timingSafeEqual(a, b)
}
```

Inside `registerUpdateRoutes`, add:

```ts
  // fork: deploy the fork's own commits. Deliberately NOT gated by the
  // UPDATE_CHECK_* switches — those suppress the outbound GitHub call for
  // privacy, and deploying local commits makes no outbound call at all.
  api.post('/api/updates/request', adminRoute(async (tenant) => ({
    update: derive(await requestUpdate(tenant.personId), Date.now()),
  })))

  api.post('/api/updates/agent-poll', async (req: Request, res: Response) => {
    if (!agentToken()) {
      return res.status(503).json({ error: 'ServiceUnavailable', message: 'UPDATE_AGENT_TOKEN not configured' })
    }
    if (!agentAuthorized(req)) {
      return res.status(401).json({ error: 'Unauthorized', message: 'bad agent token' })
    }
    const body = (req.body ?? {}) as { behind?: unknown; result?: { exitCode?: unknown; message?: unknown } }
    const behind = Number.isInteger(body.behind) ? Math.max(0, body.behind as number) : 0
    const result =
      body.result && Number.isInteger(body.result.exitCode)
        ? { exitCode: body.result.exitCode as number, message: String(body.result.message ?? '').slice(0, 2000) }
        : undefined
    const { state, pending } = await agentPoll(behind, result)
    return { pending, update: derive(state, Date.now()) }
  })
```

Add `Response` to the existing `lambda-api` type import if it isn't already there.

Finally, include the state in `GET /api/updates`. Every `return` in that handler gains `update`, so hoist it once at the top of the handler:

```ts
  api.get('/api/updates', adminRoute(async (tenant) => {
    const current = { version: version.pkg, sha: version.sha, fork: version.fork }
    // fork: always present, even when the GitHub check is off — see comment above.
    const update = derive(await readState(), Date.now())
    if (!envEnabled()) return { enabled: false, reason: 'env', current, update }
    if (!(await householdEnabled(tenant.householdId))) return { enabled: false, current, update }
    // …unchanged…
    return { enabled: true, current, latest, updateAvailable, checkedAt: …, update, ...(c.error ? { error: c.error } : {}) }
  }))
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd apps/api && npx vitest run test/update-button.integration.test.ts test/updates.integration.test.ts`
Expected: PASS — new suite green, and the pre-existing notifier suite still green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/updates/updates.ts apps/api/src/app.ts apps/api/src/platform/rate-limit.ts apps/api/test/update-button.integration.test.ts
git commit -m "feat(api): request + agent-poll routes for the in-app update button"
```

---

### Task 4: Concurrency lock in update.ps1

**Files:**
- Modify: `update.ps1` (after the `Set-Location $PSScriptRoot` line)
- Test: `tests/update-lock.test.ps1` (new); confirm the harness location first with `ls tests/`

**Interfaces:**
- Produces: `update.ps1` exits 0 immediately when another run holds `.update.lock`.

This is the bug the button *introduces* — today only one caller exists, so nothing races.

- [ ] **Step 1: Write the failing test**

```powershell
# tests/update-lock.test.ps1 — run: powershell -ExecutionPolicy Bypass -File tests/update-lock.test.ps1
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$lock = Join-Path $repo '.update.lock'

# Hold the lock exactly as update.ps1 does, then confirm a second run bows out.
$held = [System.IO.File]::Open($lock, 'OpenOrCreate', 'ReadWrite', 'None')
try {
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'update.ps1') 2>&1
    if ($LASTEXITCODE -ne 0) { throw "FAIL: expected exit 0 while locked, got $LASTEXITCODE" }
    if ($out -notmatch 'already running') { throw "FAIL: expected an 'already running' notice, got: $out" }
    Write-Host "PASS: concurrent run bowed out cleanly." -ForegroundColor Green
} finally {
    $held.Close()
    Remove-Item $lock -ErrorAction SilentlyContinue
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `powershell -ExecutionPolicy Bypass -File tests/update-lock.test.ps1`
Expected: FAIL — the second run ignores the lock and proceeds into `git fetch`.

- [ ] **Step 3: Take the lock in `update.ps1`**

Immediately after `Set-Location $PSScriptRoot`:

```powershell
# Only one update may run at a time. The button, the (suspended) nightly task and
# a manual run all land here, and two concurrent `docker compose up --build` runs
# against one stack corrupt each other. FileShare::None is the mutex; the handle
# dies with the process, so a crashed run cannot wedge the lock.
$lockPath = Join-Path $PSScriptRoot '.update.lock'
try {
    $script:UpdateLock = [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
    Write-Host "Another update is already running -- nothing to do." -ForegroundColor Yellow
    exit 0
}
```

- [ ] **Step 4: Ignore the lockfile in git**

Append to `.gitignore`:

```
# Mutex held while update.ps1 runs (see the lock block at the top of that script).
.update.lock
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `powershell -ExecutionPolicy Bypass -File tests/update-lock.test.ps1`
Expected: `PASS: concurrent run bowed out cleanly.`

- [ ] **Step 6: Commit**

```bash
git add update.ps1 tests/update-lock.test.ps1 .gitignore
git commit -m "fix(tools): serialize update.ps1 runs behind an exclusive lockfile"
```

---

### Task 5: Host update agent and task registration

**Files:**
- Create: `tools/update-agent/poll-update.ps1`
- Create: `tools/update-agent/README.md`
- Modify: `tools/server-move/setup-pc-server.ps1` (header ~line 11; task block ~lines 228-233)
- Modify: `tools/server-move/export-server-bundle.ps1` (freeze block ~line 103)

**Interfaces:**
- Consumes: `POST /api/updates/agent-poll` from Task 3; `UPDATE_AGENT_TOKEN` from Task 2; `update.ps1` from Task 4.
- Produces: Scheduled Task `"Waffled Fork Update Agent"`, running every 60s.

- [ ] **Step 1: Write the agent**

```powershell
# tools/update-agent/poll-update.ps1 -- host side of the in-app update button.
#
# Runs every 60s as the "Waffled Fork Update Agent" scheduled task. Deliberately
# dumb: it reports how far behind origin/main we are, asks the API whether an
# admin pressed "Update now", and if so runs update.ps1 and reports the result.
# All real deploy logic stays in update.ps1 -- this file must never grow any.
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $repo

$api      = if ($env:WAFFLED_API) { $env:WAFFLED_API } else { 'http://127.0.0.1:3000' }
$envFile  = Join-Path $repo 'infra\compose\.env'
$stampDir = Join-Path $repo '.update-agent'
$stamp    = Join-Path $stampDir 'last-fetch'

if (-not (Test-Path $envFile)) { exit 0 }   # not a configured server -- stay quiet
$token = (Select-String -Path $envFile -Pattern '^UPDATE_AGENT_TOKEN=(.+)$').Matches.Groups[1].Value
if (-not $token) { exit 0 }                 # pre-token install; ./waffled up will add it

# Fetch at most every 15 minutes -- polling is 1x/min, but hitting GitHub 1440x a
# day to answer a question that changes on push would be rude and pointless.
if (-not (Test-Path $stampDir)) { New-Item -ItemType Directory -Path $stampDir | Out-Null }
$due = -not (Test-Path $stamp) -or ((Get-Date) - (Get-Item $stamp).LastWriteTime).TotalMinutes -ge 15
if ($due) {
    git fetch origin 2>$null | Out-Null
    if (-not (Test-Path $stamp)) { New-Item -ItemType File -Path $stamp | Out-Null } else { (Get-Item $stamp).LastWriteTime = Get-Date }
}
$behind = 0
try { $behind = [int](git rev-list --count HEAD..origin/main 2>$null) } catch { $behind = 0 }

function Send-Poll($body) {
    return Invoke-RestMethod -Method Post -Uri "$api/api/updates/agent-poll" `
        -Headers @{ 'x-waffled-update-token' = $token } `
        -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 5) -TimeoutSec 20
}

try { $r = Send-Poll @{ behind = $behind } } catch { exit 0 }  # API down; try again next minute
if (-not $r.pending) { exit 0 }

# An admin pressed the button. Run the real updater and capture its tail.
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'update.ps1') 2>&1
$code = $LASTEXITCODE
$msg = ($out | Select-Object -Last 12 | Out-String).Trim()
if (-not $msg) { $msg = if ($code -eq 0) { 'Update complete.' } else { "update.ps1 exited $code." } }

# The rebuild just restarted the API, so it is NOT up the instant update.ps1
# returns. Retry for ~2 minutes or the result is lost and the UI shows "updating"
# until the stuck timeout.
for ($i = 0; $i -lt 12; $i++) {
    try { Send-Poll @{ behind = 0; result = @{ exitCode = $code; message = $msg } } | Out-Null; break }
    catch { Start-Sleep -Seconds 10 }
}
```

- [ ] **Step 2: Ignore the fetch stamp**

Append to `.gitignore`:

```
# Host update agent's last-fetch stamp (tools/update-agent/poll-update.ps1).
.update-agent/
```

- [ ] **Step 3: Write `tools/update-agent/README.md`**

```markdown
# Host update agent

The host half of the in-app **Update now** button (Settings → System Health).

`poll-update.ps1` runs every 60 seconds as the scheduled task
**"Waffled Fork Update Agent"**. Each tick it:

1. reports how many commits `origin/main` is ahead (refreshed by `git fetch` at
   most every 15 minutes), which is what drives the "N new commits ready to
   deploy" banner;
2. asks the API whether an admin pressed the button;
3. if so, runs `update.ps1` and reports its exit code and output tail back.

It authenticates with `UPDATE_AGENT_TOKEN` from `infra/compose/.env`, which
`./waffled up` generates. No deploy logic lives here — it all stays in
`update.ps1`, so a manual run and a button press do exactly the same thing.

**If the button says "update agent isn't responding":** the task isn't running.
Check it with `schtasks /query /tn "Waffled Fork Update Agent"`, and re-enable it
with `schtasks /change /tn "Waffled Fork Update Agent" /enable`. Note that
`tools/server-move/export-server-bundle.ps1` disables it deliberately when
freezing a retired server.

Register it manually (setup-pc-server.ps1 does this for you):

    schtasks /create /f /tn "Waffled Fork Update Agent" /sc minute /mo 1 \
      /tr "powershell -NoProfile -ExecutionPolicy Bypass -File C:\path\to\repo\tools\update-agent\poll-update.ps1"
```

- [ ] **Step 4: Register the agent and suspend the nightly job**

In `tools/server-move/setup-pc-server.ps1`, replace the task block at ~lines 228-233:

```powershell
# ── Always-on server plumbing ──────────────────────────────────────────────
Step "Update tasks (button agent every minute; nightly job suspended)"
$updatePs1 = Join-Path $RepoDir 'update.ps1'
$agentPs1  = Join-Path $RepoDir 'tools\update-agent\poll-update.ps1'

# The in-app "Update now" button (Settings → System Health) is the update path now.
schtasks /create /f /tn "Waffled Fork Update Agent" /sc minute /mo 1 `
    /tr "powershell -NoProfile -ExecutionPolicy Bypass -File `"$agentPs1`"" | Out-Null
Write-Host "Task 'Waffled Fork Update Agent' registered (every 60s)."

# Registered but DISABLED: the button replaced it. Suspended rather than deleted so
# bringing hands-free nightly updates back is one command, not a rebuild:
#   schtasks /change /tn "Waffled Fork Update" /enable
schtasks /create /f /tn "Waffled Fork Update" /sc daily /st 03:30 `
    /tr "powershell -NoProfile -ExecutionPolicy Bypass -File `"$updatePs1`"" | Out-Null
schtasks /change /tn "Waffled Fork Update" /disable | Out-Null
Write-Host "Task 'Waffled Fork Update' registered but disabled (nightly auto-update suspended)."
```

Update the header comment at ~line 11 from:

```
#   * nightly "Waffled Fork Update" task at 3:30 AM running update.ps1
```

to:

```
#   * "Waffled Fork Update Agent" task every 60s (powers the in-app Update button)
#   * "Waffled Fork Update" nightly task at 3:30 AM -- registered but DISABLED
```

- [ ] **Step 5: Add the agent to the freeze list**

In `tools/server-move/export-server-bundle.ps1`, at ~line 103, below the existing disable:

```powershell
    schtasks /change /tn "Waffled Fork Update" /disable 2>$null | Out-Null
    # The agent runs every 60s and would rebuild + re-grab the Tailscale name on a
    # machine we just retired. Freezing means freezing BOTH tasks.
    schtasks /change /tn "Waffled Fork Update Agent" /disable 2>$null | Out-Null
```

Also update the two operator-facing strings that say "nightly update task" (lines ~97 and ~133) to "update tasks".

- [ ] **Step 6: Verify the agent runs clean against the live API**

Run: `powershell -ExecutionPolicy Bypass -File tools/update-agent/poll-update.ps1; echo "exit=$?"`
Expected: exits 0 silently. Then confirm the API saw it:

Run: `curl -s -X POST http://127.0.0.1:3000/api/updates/agent-poll -H "x-waffled-update-token: $(grep '^UPDATE_AGENT_TOKEN=' infra/compose/.env | cut -d= -f2)" -H 'content-type: application/json' -d '{"behind":0}'`
Expected: `{"pending":false,"update":{...,"agentDown":false,...}}`

- [ ] **Step 7: Commit**

```bash
git add tools/update-agent tools/server-move/setup-pc-server.ps1 tools/server-move/export-server-bundle.ps1 .gitignore
git commit -m "feat(tools): host update agent; suspend the nightly auto-update task"
```

---

### Task 6: Web API client and Settings UI

**Files:**
- Modify: `apps/web/src/lib/api/updates.ts`
- Modify: `apps/web/src/kiosk/Settings.tsx` (`UpdateBanner` ~line 607, `SystemHealthPanel` ~line 478)
- Test: `apps/web/src/kiosk/Settings.test.tsx`

**Interfaces:**
- Consumes: `GET /api/updates` (now carrying `update`), `POST /api/updates/request` from Task 3.
- Produces: `interface DeployState { status: 'idle'|'queued'|'running'|'failed'; behindCount: number; message: string | null; agentDown: boolean; stuck: boolean }`; `UpdateInfo.update: DeployState`; `updatesApi.requestUpdate(): Promise<{ update: DeployState }>`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/kiosk/Settings.test.tsx`:

```tsx
describe('update deploy row', () => {
  const base = {
    enabled: true, current: { version: '0.8.0', sha: 'abc1234', fork: 'v0.8.0-12-gabc1234' },
    latest: null, updateAvailable: false, checkedAt: '2026-08-26T12:00:00Z',
  }
  const deploy = (over = {}) => ({ status: 'idle', behindCount: 0, message: null, agentDown: false, stuck: false, ...over })

  it('offers a deploy when commits are waiting', async () => {
    renderUpdateRow({ ...base, update: deploy({ behindCount: 3 }) })
    expect(await screen.findByText(/3 new commits ready to deploy/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /update now/i })).toBeEnabled()
  })

  it('disables the button while queued', async () => {
    renderUpdateRow({ ...base, update: deploy({ status: 'queued', behindCount: 3 }) })
    expect(await screen.findByText(/starting within a minute/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /update now/i })).toBeDisabled()
  })

  it('shows progress, not an error, while running', async () => {
    renderUpdateRow({ ...base, update: deploy({ status: 'running' }) })
    expect(await screen.findByText(/kiosk will reload itself/i)).toBeInTheDocument()
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument()
  })

  it('surfaces the real failure message', async () => {
    renderUpdateRow({ ...base, update: deploy({ status: 'failed', message: 'Working tree has uncommitted changes' }) })
    expect(await screen.findByText(/uncommitted changes/i)).toBeInTheDocument()
  })

  it('warns when the host agent is silent', async () => {
    renderUpdateRow({ ...base, update: deploy({ agentDown: true, behindCount: 2 }) })
    expect(await screen.findByText(/agent isn't responding/i)).toBeInTheDocument()
  })
})
```

Add a `renderUpdateRow` helper next to the file's existing render helpers, mocking `updatesApi.get` to resolve the supplied object and rendering `<SystemHealthPanel />` (export it if the test file cannot reach it; follow whatever pattern the file already uses for panel-level tests).

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/web && npx vitest run src/kiosk/Settings.test.tsx -t "update deploy row"`
Expected: FAIL — none of the strings render.

- [ ] **Step 3: Extend the API client**

```ts
// apps/web/src/lib/api/updates.ts
// fork: deploy state for the in-app Update button. Reported by the host agent —
// the API cannot see git from inside its container.
export interface DeployState {
  status: 'idle' | 'queued' | 'running' | 'failed'
  behindCount: number
  message: string | null
  agentDown: boolean
  stuck: boolean
}
```

Add `update: DeployState` to `UpdateInfo`, and to the `updatesApi` object:

```ts
  requestUpdate: () => apiSend<{ update: DeployState }>('POST', '/api/updates/request'),
```

Match the file's existing `apiSend`/`apiPost` helper name and signature.

- [ ] **Step 4: Render the deploy row**

Extend `UpdateBanner` in `Settings.tsx` with a fork deploy section **above** the existing upstream-release content (leaving that content untouched, per the fork rule). Add `onDeploy` and `deploying` props:

```tsx
  // fork: deploying the fork's own commits is a different act from upgrading to an
  // upstream release — this row is about `origin/main`, the block below is about GitHub.
  const d = upd.update
  const deployRow = (
    <div style={{ marginBottom: d.status === 'idle' && d.behindCount === 0 && !d.agentDown ? 0 : 10 }}>
      {d.status === 'failed' ? (
        <>
          <div className="card-h" style={{ margin: 0 }}>⚠ Update failed</div>
          <div className="tiny muted" style={{ fontWeight: 600 }}>{d.message || 'update.ps1 exited non-zero.'}</div>
        </>
      ) : d.stuck ? (
        <>
          <div className="card-h" style={{ margin: 0 }}>⚠ Update seems stuck</div>
          <div className="tiny muted" style={{ fontWeight: 600 }}>Still running after 30 minutes — check the server.</div>
        </>
      ) : d.status === 'running' ? (
        <>
          <div className="card-h" style={{ margin: 0 }}>⟳ Updating…</div>
          <div className="tiny muted" style={{ fontWeight: 600 }}>
            This takes a few minutes; the kiosk will reload itself when it's done.
          </div>
        </>
      ) : d.status === 'queued' ? (
        <>
          <div className="card-h" style={{ margin: 0 }}>⟳ Queued</div>
          <div className="tiny muted" style={{ fontWeight: 600 }}>Starting within a minute.</div>
        </>
      ) : d.behindCount > 0 ? (
        <>
          <div className="card-h" style={{ margin: 0 }}>
            ⬆ {d.behindCount} new commit{d.behindCount === 1 ? '' : 's'} ready to deploy
          </div>
          <div className="tiny muted" style={{ fontWeight: 600 }}>From this fork's main. Running {running}.</div>
        </>
      ) : null}
      {d.agentDown && (
        <div className="tiny muted" style={{ fontWeight: 600, marginTop: 4 }}>
          ⚠ The update agent isn't responding — check the "Waffled Fork Update Agent" task on the server.
        </div>
      )}
      {d.status !== 'running' && d.status !== 'queued' && (
        <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={deploying} onClick={onDeploy}>
          Update now
        </button>
      )}
      {(d.status === 'running' || d.status === 'queued') && (
        <button className="btn btn-primary" style={{ marginTop: 8 }} disabled>Update now</button>
      )}
    </div>
  )
```

Render `{deployRow}` at the top of the `SettingCard`'s flex child.

- [ ] **Step 5: Wire polling and the press in `SystemHealthPanel`**

Replace the one-shot `updatesApi.get()` with a poll, and add the handler:

```tsx
  const [deploying, setDeploying] = useState(false)
  // fork: the deploy row is live state, so poll it — but keep it OFF the 10s health
  // loop, since the GitHub half of this payload is a slow cached outbound call.
  useEffect(() => {
    let alive = true
    const loadUpd = () => updatesApi.get().then((d) => alive && setUpd(d)).catch(() => {
      // Expected while a rebuild restarts the API — never surface it as an error,
      // or every successful update flashes "connection lost".
    })
    loadUpd()
    const t = setInterval(loadUpd, 15000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  async function deployNow() {
    setDeploying(true)
    try {
      const r = await updatesApi.requestUpdate()
      setUpd((prev) => (prev ? { ...prev, update: r.update } : prev))
    } catch { /* the poll above will re-sync */ }
    finally { setDeploying(false) }
  }
```

Pass `onDeploy={deployNow} deploying={deploying}` to `<UpdateBanner …>`, and delete the old one-shot `updatesApi.get()` line from the health `useEffect`.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd apps/web && npx vitest run src/kiosk/Settings.test.tsx`
Expected: PASS — new cases green, existing Settings cases still green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api/updates.ts apps/web/src/kiosk/Settings.tsx apps/web/src/kiosk/Settings.test.tsx
git commit -m "feat(web): Update now button and deploy status in System Health"
```

---

### Task 7: Update banner in the app-wide modal

**Files:**
- Modify: `apps/web/src/kiosk/components/UpdateModal.tsx`
- Test: `apps/web/src/kiosk/components/UpdateModal.test.tsx`

**Interfaces:**
- Consumes: `UpdateInfo.update` and `updatesApi.requestUpdate` from Task 6.

Reuses the existing admin-only, dismissal-persisted modal already mounted in `KioskLayout` rather than hand-rolling a second banner.

- [ ] **Step 1: Write the failing test**

```tsx
it('offers to deploy waiting fork commits', async () => {
  mockGet({ enabled: true, updateAvailable: false, latest: null,
            current: { version: '0.8.0', sha: 'abc', fork: 'v0.8.0-12-gabc' },
            update: { status: 'idle', behindCount: 4, message: null, agentDown: false, stuck: false } })
  render(<UpdateModal />)
  expect(await screen.findByText(/4 new commits ready to deploy/i)).toBeInTheDocument()
})

it('stays shut when nothing is waiting', async () => {
  mockGet({ enabled: true, updateAvailable: false, latest: null,
            current: { version: '0.8.0', sha: 'abc', fork: 'v0.8.0-12-gabc' },
            update: { status: 'idle', behindCount: 0, message: null, agentDown: false, stuck: false } })
  render(<UpdateModal />)
  await waitFor(() => expect(screen.queryByText(/ready to deploy/i)).not.toBeInTheDocument())
})

it('does not re-nag at the same commit count once dismissed', async () => {
  localStorage.setItem('waffled.update.deployDismissed', '4')
  mockGet({ enabled: true, updateAvailable: false, latest: null,
            current: { version: '0.8.0', sha: 'abc', fork: 'v0.8.0-12-gabc' },
            update: { status: 'idle', behindCount: 4, message: null, agentDown: false, stuck: false } })
  render(<UpdateModal />)
  await waitFor(() => expect(screen.queryByText(/ready to deploy/i)).not.toBeInTheDocument())
})
```

Use the file's existing mocking helper for `updatesApi.get` (named `mockGet` here — match whatever it actually is).

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/web && npx vitest run src/kiosk/components/UpdateModal.test.tsx`
Expected: FAIL — the deploy copy never renders.

- [ ] **Step 3: Add the deploy case to the modal**

```tsx
// fork: a second reason to open — commits are on the fork's main but not deployed.
// Keyed by commit count so it re-nags when more land, mirroring how the release
// case re-nags on a newer tag.
const DEPLOY_DISMISS_KEY = 'waffled.update.deployDismissed'
```

In the effect, after the existing release check:

```tsx
        const behind = r.update?.behindCount ?? 0
        const failed = r.update?.status === 'failed'
        const dismissed = localStorage.getItem(DEPLOY_DISMISS_KEY)
        if (!open && (failed || (behind > 0 && dismissed !== String(behind)))) {
          setDeployOpen(true)
        }
```

Render a deploy variant with the same `.modal-overlay` / `.modal-card` markup the release case uses, with an `Update now` (`btn btn-primary`, calls `updatesApi.requestUpdate()` then closes) and a `Later` (`btn btn-ghost`, writes `String(behind)` to `DEPLOY_DISMISS_KEY` then closes). `agentDown` and `stuck` deliberately do **not** open the modal — they are operator conditions, surfaced in Settings only, and a modal for them would nag the whole family.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd apps/web && npx vitest run src/kiosk/components/UpdateModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/kiosk/components/UpdateModal.tsx apps/web/src/kiosk/components/UpdateModal.test.tsx
git commit -m "feat(web): app-wide banner when fork commits are ready to deploy"
```

---

### Task 8: Documentation and changelog

**Files:**
- Modify: `README.md:50-66`
- Modify: `docs/product/roadmap.md:~202`
- Modify: `tools/server-move/README.md:4,18,47`
- Modify: `website/docs/src/content/docs/reference/features.md`
- Create: a how-to page under `website/docs/src/content/docs/` (match the neighbouring pages' Starlight frontmatter and voice)
- Modify: `CHANGELOG.md`

Repo rule: doc-only follow-ups have bitten three times, so every stale phrase gets fixed here, in this PR.

- [ ] **Step 1: Find every stale mention**

Run: `grep -rn "nightly\|schedule it nightly\|3:30" README.md docs/ tools/ website/ --include=*.md`
Expected: a list covering at least `README.md:61`, `docs/product/roadmap.md:203`, `tools/server-move/README.md:4,18,47`.

- [ ] **Step 2: Rewrite the README update section**

Replace the "For hands-free updates, schedule it nightly (Task Scheduler)" sentence with the button as the primary path, keeping `.\update.ps1` documented as the manual equivalent:

```markdown
- **Deploy the latest fork code (the "update button"):** press **Update now** in
  Settings → System Health — the kiosk shows a banner when commits are waiting, and
  reloads itself once the new build is live. A host task ("Waffled Fork Update Agent")
  picks the request up within a minute and runs `update.ps1`, which fast-forwards to
  `origin/main` — always CI-tested — and rebuilds from source. Running `.\update.ps1`
  from PowerShell does exactly the same thing.
- **Nightly auto-update is suspended.** The "Waffled Fork Update" task is registered
  but disabled now that the button exists. Bring it back with
  `schtasks /change /tn "Waffled Fork Update" /enable`.
```

- [ ] **Step 3: Update the roadmap, server-move README, and features reference**

Move the item to *Done* in `docs/product/roadmap.md` and drop "schedulable nightly". In `tools/server-move/README.md`, change "nightly auto-update" to "auto-update agent" and note that the freeze step disables **both** tasks. Add the button to the features reference, matching the surrounding entries' voice.

- [ ] **Step 4: Write the how-to page**

A short page covering: where the button is, who can press it (admins), what happens minute-by-minute, and the three things that can go wrong (dirty tree, diverged history, agent not running) with their fixes. Match the Starlight frontmatter of a neighbouring how-to.

- [ ] **Step 5: Add the changelog entry**

Under `## [Unreleased]` → `### Added`, a bold lead plus a plain-language sentence:

```markdown
- **Update at the push of a button.** Admins can now deploy the latest fork code from
  Settings → System Health — the kiosk shows a banner when new commits are waiting,
  applies them in the background, and reloads itself when the new build is live. The
  nightly 3:30 AM auto-update is suspended now that updates are on demand.
```

- [ ] **Step 6: Confirm nothing stale is left**

Run: `grep -rn "schedule it nightly\|nightly auto-update\|schedulable nightly" README.md docs/ tools/ website/ --include=*.md`
Expected: no hits (or only the deliberate "suspended" references).

- [ ] **Step 7: Commit**

```bash
git add README.md docs/product/roadmap.md tools/server-move/README.md website/ CHANGELOG.md
git commit -m "docs: the update button replaces the nightly auto-update job"
```

---

## Final verification (before opening the PR)

- [ ] `cd apps/api && npm test` — all green
- [ ] `cd apps/api && npx tsc --noEmit` — clean
- [ ] `cd apps/web && npm test` — all green
- [ ] `cd apps/web && npm run build` — clean
- [ ] `cd apps/api && npm run check:migrations` — no collision
- [ ] Manual: press the button on the running kiosk, confirm banner → queued → updating → reload, and confirm Settings → About shows the new SHA
- [ ] Manual: `schtasks /query /tn "Waffled Fork Update"` shows **Disabled**; `…/tn "Waffled Fork Update Agent"` shows **Ready**
