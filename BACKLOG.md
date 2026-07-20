# Fork development backlog

Autonomous work queue for the Waffled fork (dispencer17/waffled). Each item is
self-contained: an agent with no other context should be able to execute it from
this file plus the repo. Work items TOP TO BOTTOM (they're dependency-ordered).
Check an item off only when its **Done when** criteria are ALL met, and append a
one-line result note under it.

**Ground rules for every item (from CLAUDE.md + hard-won session lessons):**
- Branch per item (`git checkout -b <slug>` from up-to-date `main`); TDD — failing
  test first; merge to `main` + push ONLY with local typecheck + relevant tests
  green. Pushed main auto-deploys to the family kiosk via the 3:30 AM scheduled
  task, so main must always be shippable.
- Additive schema only; fork migrations number from 0102 up. Never touch
  `.github/workflows/*` (the gh token lacks `workflow` scope — the push will be
  REJECTED). Never rename `google_*` columns. Shell scripts stay LF
  (.gitattributes enforces it). `infra/compose/.env` is user-local — never commit
  secrets.
- After merging to main: `git push origin main`, confirm CI kicks off
  (`gh run list --repo dispencer17/waffled --limit 1`). Don't wait for CI to
  finish before starting the next item, but check the previous run's verdict at
  each item boundary and fix regressions before anything else.
- The stack runs locally (Docker) — verify server-touching work against it where
  practical: admin API token via
  `docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env run --rm --no-deps -T api node dist/mint-token.js --sub '52000be4-31a4-4f83-8e29-588076776073' --household '40c30227-ba00-4e3c-8ebd-c6033f8b746d'`
- Log user-facing changes in CHANGELOG.md `[Unreleased]` as you land them.

---

## P1 — Merge upstream v0.8.0 (142 commits)

- [ ] **Merge `upstream/main` (v0.8.0) into fork `main`.**

**Why:** upstream has moved 142 commits (bug fixes + features) since the fork
point; the longer we wait the harder every future merge gets.

**How:** `git fetch upstream`, branch `merge/upstream-v0.8.0` off `main`, then
`git merge upstream/main`. Expected conflict hotspots (fork features touch these
shared files): `apps/web/src/kiosk/Settings.tsx` (nav array + panel dispatch +
SmartHomePanel/AppearancePanel), `apps/api/src/app.ts` (route registration +
PUBLIC_PATHS — keep BOTH `/auth/microsoft/calendar/callback` and any new
upstream entries), `apps/api/src/platform/modules.ts` + `apps/web/src/lib/modules.ts`
(module catalogs — keep `smartHome`), `apps/api/src/platform/config.ts` (keep the
`microsoft` block using the `env()` helper), `CHANGELOG.md` (keep both sides'
entries under Unreleased), `apps/web/src/kiosk/Today.tsx` (smartHome card),
`apps/web/src/kiosk/KioskDisplay.tsx` (build-watch + sunset dim resolution),
`apps/web/src/lib/theme.ts` ('sun' pref). If upstream renamed/moved something a
fork feature wraps (e.g. calendar service internals), adapt the fork side —
upstream wins on structure, fork wins on features.

**Verify:** `npx tsc --noEmit` in BOTH apps/api and apps/web; full
`npm test` in apps/web; in apps/api run at least:
`npx vitest run test/calendar-sync-msft.integration.test.ts test/calendar-sync.integration.test.ts test/homeassistant.integration.test.ts test/shopping.integration.test.ts test/voice.integration.test.ts test/config-microsoft.unit.test.ts`
(full API suite if time allows — needs Docker, ~9 min). Check upstream's new
migrations don't collide with 0100/0101 (`npm run check:migrations`).

**Done when:** merged to `main`, pushed, CI green, and a spot-check of the
running stack after `.\update.ps1 -Force` (or the nightly task) still shows the
fork features (Appearance tab, Smart Home in Modules, Connect Outlook button).

---

## P2 — ICS calendar feeds (read-only subscriptions)

- [ ] **Add "subscribe to a calendar feed (ICS URL)" as a third calendar source.**

**Why:** the user's employer will likely deny OAuth access to the work Outlook
calendar (OIT request pending, expectations low). Outlook/Google/school/sports
calendars can all publish read-only ICS URLs — ingesting those covers the gap
with zero OAuth. This was explicitly promised as "plan B."

**How:** new module `apps/api/src/modules/calendar/ics-feeds.ts` (+ routes), NOT
a provider adapter (no OAuth, no write-back, no per-account tokens — simpler as
its own table). Migration `0102_ics_feeds.sql`: `ics_feeds(id, household_id,
url, name, person_id, visibility, last_synced_at, last_error, created_at,
deleted_at)`. Poll in the existing scheduler cadence (piggyback a
`runJob('ics-sync')` interval in server.ts like calendar-sync). Parse with the
`ical.js` npm package (add to apps/api deps) or a minimal hand parser — prefer
`ical.js` (battle-tested; handles folding/timezones). Map VEVENTs into `events`
with `origin='ics'`, `calendar_id` NULL, external key = feed id + UID in
`google_event_id` (documented convention: "provider external id"), soft-delete
events that disappear from the feed. RRULE VEVENTs: store the master with its
RRULE in the existing recurrence column so upstream's expansion service handles
occurrences (check how events.rrule/expansion works in
`apps/api/src/modules/calendar/expansion.service.ts` and mirror what a manual
recurring event stores). Routes: GET/POST `/api/calendar/feeds`,
PATCH/DELETE `/api/calendar/feeds/:id`, POST `/api/calendar/feeds/:id/sync`
(admin). Include feeds in the `/api/calendar/google/status` payload (add
`feeds: [...]`) so the web Calendars panel can list them. Web: Settings →
Calendars gains an "Add calendar feed" row (URL + name + person mapping),
reusing the existing calendar-row UI patterns in `Settings.tsx` CalendarsPanel.

**Verify (TDD):** `apps/api/test/ics-feeds.integration.test.ts` with an
in-process HTTP stub serving a fixture ICS (timed event, all-day event, a
recurring weekly event, then a second fetch with one event removed → soft
delete; a 404 feed → last_error set). Web: extend Settings tests for the new
row. Typecheck both apps.

**Done when:** tests green, merged, pushed, CI green, CHANGELOG entry added,
and a real-world smoke: subscribe the stack to a public ICS (e.g.
https://www.officeholidays.com/ics/usa — US holidays) via the API and see
events for the current month in `GET /api/events`.

---

## P3 — First-class "Share list" (Walmart-API-free grocery handoff)

- [ ] **Make the grocery handoff work fully without Walmart credentials.**

**Why:** the user abandoned the Walmart affiliate application. The fallback
(text share) must be the polished primary path, not an error state.

**How:** in `apps/web/src/kiosk/components/WalmartHandoff.tsx` +
`GroceryBoard.tsx`: when `GET /api/shopping/walmart/status` reports
unconfigured, the grocery board button reads **"Share list"** (not "Send to
Walmart") and opens directly to the share/copy view — clean formatted list
(unchecked items grouped by aisle, quantities included), `navigator.share` when
available, clipboard fallback, plus a QR code that encodes the plain text so a
phone can grab it without any account. No API/server changes should be needed
(verify the status route already 200s with `configured:false` when env vars are
absent — it does per the shopping integration tests). Keep the Walmart matching
path intact for if credentials ever appear.

**Verify (TDD):** component test: unconfigured status → button label "Share
list", share view renders the formatted text with aisle groups; configured
status → existing Walmart flow unchanged. Run the web suite.

**Done when:** tests green, merged, pushed, CI green, CHANGELOG updated
(reword the existing Walmart entry to lead with list sharing).

---

## P4 — Dark-mode visual sweep with Playwright (screenshots both themes)

- [ ] **Drive the running kiosk with Playwright, capture light+dark screenshots
  of every page, review them, and fix what's broken.**

**Why:** dark mode has never been looked at by anyone — the repo's own web
CLAUDE.md mandates Playwright-driven visual verification, and the family sees
this nightly after sunset.

**How:** the stack is live at http://localhost:8080 with seeded content.
`npm i -D playwright` in a scratch dir (or use `npx playwright` with chromium),
script: inject the admin token (mint as in ground rules; the web app stores it —
check `apps/web/src/lib/api/client.ts` for the storage key, e.g.
localStorage 'waffled.token' — read the code, don't guess), then for each route
(/, /calendar, /meals, /meals/recipes, /lists, /tasks, /photos, /goals,
/pantry, /settings?tab=appearance, /settings?tab=display) capture at 1280x800 in
BOTH themes (set localStorage `waffled:theme` to 'light' then 'dark').
Save PNGs to the session scratchpad. REVIEW EVERY IMAGE (Read tool renders
them): look for unreadable text (dark-on-dark/light-on-light), invisible
borders/dividers, stuck-light surfaces (hardcoded hex instead of tokens),
broken contrast on chips/pills/badges. Fix root causes in the CSS token layer
(`apps/web/src/styles/*.css`) — prefer fixing the variable, not per-component
overrides. Re-screenshot after fixes.

**Verify:** before/after screenshots for anything fixed; web suite green
(CSS-only changes still run the suite).

**Done when:** all pages reviewed in both themes, fixes merged + pushed + CI
green, and a short findings note (per-page OK/fixed list) appended below this
item. Leave the final screenshot set in the scratchpad for the user's morning
review.

---

## P5 — Documentation debt for all six fork features

- [ ] **Bring the docs site + roadmap in line with what the fork actually does.**
  (Repo rule: "a feature isn't done until users could find and understand it.")

**How:** following existing Starlight frontmatter/voice in
`website/docs/src/content/docs/`: (1) update `reference/features.md` with the
fork features; (2) update `docs/product/roadmap.md` (move shipped items to Done);
(3) new/updated how-to pages: `administration/outlook-calendar.md` (Azure app
registration incl. the personal-vs-work account distinction, tenant-consent
caveat, AADSTS gotchas we hit), `features/appearance.md` (add Follow the sun +
sunset night dim + Fully Kiosk backlight note), `features/smart-home.md` (HA
connection, pinned-entity allowlist, the Alexa-devices-via-HA explanation),
`features/voice.md` (push-to-talk, local Whisper vs OpenAI, wake word status:
deferred), `features/lists.md` (add the Share list handoff), NEW
`guides/android-phones.md` (PWA install, TWA sideload build), and if P2 landed,
ICS feeds in the calendar docs. Also update the fork README's feature list to
match reality (Walmart → "Share list", wake word → deferred).

**Verify:** `npm run build` (or astro build) in website/docs compiles clean.

**Done when:** docs build green, merged, pushed. (Docs are outside CI's paths —
the local build IS the gate.)

---

## P6 (stretch) — openWakeWord spike: wake word without Picovoice

- [ ] **Prototype "always listening" using openWakeWord in the kiosk, behind the
  existing voice settings toggle.**

**Why:** Picovoice's signup wants a company email; user deferred. openWakeWord
is Apache-2.0, no account, runs locally.

**How (spike, not ship):** worktree branch. Investigate running openWakeWord's
ONNX models in-browser via `onnxruntime-web` (WASM): melspectrogram model →
embedding model → wakeword model (use a stock pretrained word like "hey jarvis"
for the spike; custom "hey waffled" training is out of scope). Wire into
`apps/web/src/lib/voice/wakeword.ts` behind the existing
`display.voice.wakeWord` setting, replacing the Porcupine path (keep the
Porcupine code deletable-cleanly or behind an engine switch). Bundle size
matters: lazy-load the models/runtime only when the toggle is on. If in-browser
proves infeasible in a timeboxed ~90 min of real effort, STOP and instead write
up findings + the fallback design (server-side wake detection over a WebRTC/WS
audio stream) as a `docs/design/wakeword.md`, and check this item off as
"spike complete — needs decision."

**Verify:** unit tests for the detection plumbing (mock the model outputs);
manual mic verification is impossible headless — flag clearly for the user.

**Done when:** either a working lazy-loaded implementation merged behind the
toggle (tests green, CI green), or the findings doc merged. Either outcome
counts — this is a spike.

---

## P7 (stretch) — Home Assistant container, ready-to-onboard

- [ ] **Add an optional `homeassistant` compose profile so the bridge is one
  command away once device brands are known.**

**How:** service in `infra/compose/docker-compose.yml` under
`profiles: ["homeassistant"]`: image `ghcr.io/home-assistant/home-assistant:stable`,
named volume `ha_config`, port 8123 on the LAN, restart unless-stopped.
Document in README fork section: start command, first-run onboarding, creating
the long-lived token, pasting it into Waffled Settings → Smart Home. Do NOT
start it by default (resource cost without user's devices). Compose config test
in the caddy/compose test family if one fits naturally.

**Done when:** `docker compose --profile homeassistant config` validates, the
service starts and serves :8123 locally (then stop it again), README updated,
merged + pushed.

---

## Explicitly NOT in this backlog (blocked on the user / other machines)

- Outlook work-account connect — waiting on OIT approval; retry is a user click.
- Google Calendar OAuth client — user is mid-walkthrough in Google Cloud console;
  when Client ID/secret arrive, wire GOOGLE_* into infra/compose/.env + restart api.
- Fully Kiosk PLUS purchase/config, tablet install, wake-word mic tests — user hardware.
- HTTPS for tablet mic (Tailscale/hostname mode) — needs user network decisions.
- HA device onboarding — needs the family's actual device brands/accounts.
- iOS work (incl. iOS dark mode) — no Xcode on this Windows machine.
