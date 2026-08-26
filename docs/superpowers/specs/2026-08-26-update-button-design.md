# One-button update for the fork kiosk

**Status:** approved design, 2026-08-26
**Scope:** an admin-pressable "Update now" button in the web app that deploys the fork's
latest CI-tested `main` to the live stack, plus retirement of the nightly auto-update task.

## Problem

Deploying fork code today means opening PowerShell on the server and running
`.\update.ps1`, or waiting for the nightly 3:30 AM Task Scheduler job
("Waffled Fork Update"). There is no way to say "deploy what I just pushed, now" from the
kiosk or a phone.

The in-app notifier (Settings → System Health, `apps/api/src/modules/updates/updates.ts`)
already reports *that* a newer version exists, but cannot apply it.

## Goals

- An admin-gated **Update now** button in Settings → System Health.
- A **banner** surfacing "N new commits ready to deploy" so the update is noticed without
  going looking.
- Honest failure reporting: dirty tree, diverged history, failed build, dead agent.
- **Suspend** (not delete) the nightly auto-update task as part of rollout.

## Non-goals

- Merging upstream. Integrating an upstream release stays deliberate and manual
  (`git fetch upstream` -> merge -> resolve -> test -> push), per `README.md`. The button
  only deploys what is already on the fork's `origin/main`.
- Rollback / version pinning. `update.ps1` is fast-forward-only by design.
- Replacing `update.ps1`. It stays the single source of deploy logic.

## Key constraint

The API runs **inside a container** with no Docker socket, no git, and only the media
volume mounted. It structurally cannot rebuild the host stack, and cannot know whether
`origin/main` is ahead.

So the request direction is **inverted**: the host asks the API for work, rather than the
API commanding the host. This needs no new privilege, no socket mount, and no new
listening port — `update.ps1` already reaches the API privately on `127.0.0.1:3000` (it
curls `/healthz` for the running SHA).

## Architecture

```
[Kiosk] press "Update now"
   |- POST /api/updates/request            (adminRoute)  --> status = queued
                                                              ^ (<=60s)
[Host task] POST /api/updates/agent-poll   (agent token) -----'  claims -> running
   |- runs update.ps1   (ff to origin/main + waffled up --build)
   |- POST /api/updates/agent-poll {result:{exitCode,message}}  -> idle | failed
        |
[Kiosk] build-watch.ts sees a new bundle hash --> reloads itself
```

Success needs no API round trip: `apps/web/src/lib/build-watch.ts` already detects a new
build by comparing the content-hashed entry bundle, which is what makes "the stack restarts
underneath the progress UI" a non-problem.

### 1. Data model — `apps/api/migrations/0103_update_state.sql`

A **single-row** table. An update rebuilds the whole stack, so this is server state, not
tenant state; putting it in `households.settings` would let two households disagree about
something that cannot be disagreed about.

| Column | Purpose |
|---|---|
| `id boolean pk default true check (id)` | singleton guard |
| `status text` | `idle` \| `queued` \| `running` \| `failed` |
| `requested_at`, `requested_by` | who pressed the button and when |
| `claimed_at` | when the agent picked it up |
| `finished_at`, `exit_code`, `message` | outcome from `update.ps1` |
| `agent_seen_at` | last contact from the host agent (liveness) |
| `behind_count` | commits on `origin/main` not yet deployed, as reported by the agent |

`running_sha` is deliberately **not** stored: the API already knows its own build via
`platform/version`.

### 2. API routes (extend `modules/updates/updates.ts`)

| Route | Guard | Behavior |
|---|---|---|
| `POST /api/updates/request` | `adminRoute` | `idle`/`failed` -> `queued`, clearing prior outcome. Already `queued`/`running` -> no-op (idempotent; double-press must not queue twice). |
| `POST /api/updates/agent-poll` | agent token | Always refreshes `agent_seen_at` + `behind_count`. With `result` -> `idle`/`failed` + outcome. Else if `queued` -> **atomically claims** (`running`, `claimed_at=now`) and returns `{pending:true}`. |

The claim is one `UPDATE ... RETURNING` so a slow rebuild overlapping the next poll cannot
double-trigger.

`GET /api/updates` gains an additive `update` object (status, behind, message, `agentDown`,
`stuck`) — additive to keep the upstream merge surface small.

**The notifier's off-switches must not disable the button.** `UPDATE_CHECK_ENABLED=false`
and the per-household `settings.updateCheck.enabled` toggle exist to suppress the *outbound
call to GitHub* (privacy / air-gapped operation). Deploying local commits makes no outbound
call at all, so the `update` object and the button stay available even when the notifier is
switched off. Conflating the two would silently strip the only deploy path from a
privacy-conscious operator.

**Agent auth.** A Scheduled Task has no session, so the agent route cannot use `adminRoute`.
It authenticates with `UPDATE_AGENT_TOKEN`, auto-generated into `infra/compose/.env` by
`./waffled up` exactly as `TOKEN_ENCRYPTION_KEY` is (`waffled:106`), and read from that file
by the task — nothing to provision by hand. Compared in constant time. If the env var is
unset the route returns 503 and never accepts. Leaving it unauthenticated because the port
is host-only would be wrong: Caddy proxies `/api/*` publicly, so anyone on the Tailnet could
clear a pending request and make the button silently unreliable.

**Derived, not stored:** `agentDown` = no `agent_seen_at` within 10 min; `stuck` = `running`
with `claimed_at` older than 30 min. Pure function over timestamps, unit-tested.

### 3. Host agent — `tools/update-agent/poll-update.ps1`

Runs every 60s as Scheduled Task **"Waffled Fork Update Agent"**. Deliberately dumb;
`update.ps1` keeps all real logic.

1. Read `UPDATE_AGENT_TOKEN` from `infra/compose/.env`.
2. `git fetch` at most every ~15 min (cached in a timestamp file) — not 1,440x/day.
   `behind = git rev-list --count HEAD..origin/main`.
3. POST `agent-poll`. If `{pending:true}` -> run `.\update.ps1`, capture exit code and the
   last lines of output.
4. POST the result, retrying with backoff for ~2 min — the API is not up the instant
   `update.ps1` returns, because the rebuild restarted it.

### 4. Web UI (`apps/web/src/kiosk/Settings.tsx` + banner)

Admin-gated. Uses the existing design system (`.btn .btn-primary`, `.set-card`), and lives
**inside** upstream's System Health panel — per `apps/web/CLAUDE.md`, fork-specific options
go in upstream's containers rather than rearranging its nav.

| State | Shown |
|---|---|
| Up to date | `Running v... - up to date`. Button stays enabled (a redeploy is harmless; `update.ps1` exits 0 with "nothing to deploy"). |
| Update ready | Banner: **N new commits ready to deploy** + `Update now`. |
| Queued | Button disabled — `Queued - starting within a minute`. |
| Updating | `Updating... takes a few minutes; the kiosk will reload itself.` |
| Failed | Red banner with the real reason, dismissible. |

**The Updating state carries the one trap:** the rebuild kills the API serving the status,
so the UI *will* see failed fetches mid-update. While `status === 'running'` those must
render as progress, **never** as an error — getting this backwards produces a scary
"connection lost" flash on every successful update.

## Failure handling

- **Dirty tree / diverged history** — `update.ps1` already exits 1 with the reason
  (`update.ps1:29`, `:42`); surface its text verbatim. The two likeliest failures on a
  machine that commits locally.
- **Build fails** — exit 1, message shown; previous containers keep running, kiosk stays up.
- **Agent not running** — `agentDown`. With the nightly suspended this is load-bearing, not
  a courtesy: the button becomes the *only* update path, so a dead agent means a silently
  frozen server. Surfaced even when nothing is pending.
- **Stuck** — `running` for >30 min.

### Concurrency (a bug this feature introduces)

Nothing today stops two `update.ps1` runs overlapping — impossible with one caller, but the
button adds a second. Fix in `update.ps1` itself: take an exclusive lockfile at entry, exit
0 quietly if held. That covers the agent, the nightly job (when re-enabled), and manual runs
uniformly, whoever calls.

## Retiring the nightly job

**Suspend, not delete** — `tools/server-move/setup-pc-server.ps1:231` still registers
`"Waffled Fork Update"`, but with `/disable`, so restoring it is one
`schtasks /change /enable` rather than reconstructing the task. Happens **on rollout**, so
there is never a window with no update path.

`tools/server-move/export-server-bundle.ps1:103` disables the nightly task when freezing a
retired server (so it cannot wake up and fight the live box for the Tailscale name
`waffled`). It names tasks by string, so the **new agent task must be added to that freeze
list** or the server-move kit quietly stops doing its job.

## Docs to update (same PR)

Repo rule: grep for stale phrasing and fix every hit — doc-only follow-ups have bitten three
times.

- `README.md:61` — "schedule it nightly"
- `docs/product/roadmap.md:203` — "schedulable nightly"
- `tools/server-move/README.md:4,18,47`
- `tools/server-move/setup-pc-server.ps1:11` — header comment
- `website/docs` features reference + a how-to for the button
- `CHANGELOG.md` -> `[Unreleased]` -> Added

## Testing

TDD, failing test first; integration strongly preferred.

- **API integration** (`apps/api/test/update-button.integration.test.ts`, testcontainers +
  real routes): request -> poll claims exactly once; second poll gets nothing; double-press
  idempotent; result recording sets `idle`/`failed`; bad/missing agent token rejected;
  non-admin rejected; 503 when `UPDATE_AGENT_TOKEN` unset.
- **Unit** — `agentDown`/`stuck` derivation; the `update.ps1` lockfile guard.
- **Web** — the five states render; specifically that a fetch failure while `running`
  renders as progress, not an error.
- **Manual** — Playwright pass against the running kiosk before calling it done
  (`apps/web/CLAUDE.md`).
