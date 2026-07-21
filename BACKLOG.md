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

- [x] **Merge `upstream/main` (v0.8.0) into fork `main`.**
  - *Result (2026-07-20): merged as c3e35d2e — 18 conflicts resolved, all fork features intact; upstream also shipped dark mode (web+iOS), fork keeps its superset (sun pref + palettes). Fork api tests migrated to upstream's shared-Postgres harness (full suite now ~50s). Verified: tsc x2, web 418 tests, api 900 tests, migrations clean. NOTE: upstream's ci.yml improvements were withheld from the push (token lacks workflow scope) — see user-blocked list.*

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
(full API suite if time allows — needs Docker, ~1 min on the shared-Postgres harness). Check upstream's new
migrations don't collide with 0100/0101 (`npm run check:migrations`).

**Done when:** merged to `main`, pushed, CI green, and a spot-check of the
running stack after `.\update.ps1 -Force` (or the nightly task) still shows the
fork features (Appearance tab, Smart Home in Modules, Connect Outlook button).

---

## P2 — ICS calendar feeds (read-only subscriptions)

- [x] **Add "subscribe to a calendar feed (ICS URL)" as a third calendar source.**
  - *Result (2026-07-20): shipped as 4ad39f66 (migration 0102, ical.js parser, 15-min ics-sync job, feeds routes + Settings UI). 10/10 new integration tests; api 910/910, web 419/419. Real-world smoke: subscribed the live stack to officeholidays.com/ics/usa → 34 events imported, Labor Day correctly on 2026-09-07. Deploy also surfaced+fixed a build-provenance race (migrate vs api image tag).*

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

- [x] **Make the grocery handoff work fully without Walmart credentials.**
  - *Result (2026-07-20): shipped as fc72890b — unconfigured Walmart now shows a "Share list" button opening an aisle-grouped share view (copy / navigator.share / QR-of-text), status-fetch failure degrades to share mode, configured Walmart flow untouched. +15 tests (web 434/434), tsc clean.*

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

## P4 — Dark-mode visual check, fork-added surfaces only

- [x] **Drive the running kiosk with Playwright, screenshot only the fork's own
  post-merge UI additions in both themes, and fix what's broken.**
  - *Result (2026-07-20): all four fork surfaces reviewed at full height in both
    themes via Playwright (viewport + 2600px-tall passes) — Display & Kiosk
    appearance section OK, Smart Home OK, Calendars incl. feeds add/list rows OK,
    grocery board + Share-list modal OK (QR correctly stays on a white tile).
    NO dark-mode defects; zero code changes needed — the fork panels use
    design-system classes so upstream's token layer carries them. Shots left in
    session scratchpad `p4/shots/` for morning review. Side observation (not
    theming): Smart Home panel shows a "Couldn't load Smart Home settings — is
    the module enabled?" banner while still rendering the connection card —
    module-state quirk, pre-existing.*

*(Scope note: originally an 11-page full sweep; narrowed 2026-07-20 — see Why.)*

**Why:** originally scoped as a full 11-page sweep on the premise that "dark
mode has never been looked at by anyone." That premise was wrong: upstream
v0.8.0 shipped a fully audited dark mode (canonical tokens, a hardcoded-color
migration pass, and even a code-review fix for two inverted-fill icons that
stayed white — commits `5a1ffc69`, `8897edaf`, `598b7b89`), plus a separate iOS
dark-mode PR — all merged into `main` via P1. The user has also since looked at
it directly and found it fine. What upstream's audit *couldn't* have covered is
UI that didn't exist yet when it ran: the fork's own Appearance/Smart Home
panels (sun-preference + palette picker, `SmartHomePanel` in
`apps/web/src/kiosk/Settings.tsx`) and everything added by P2/P3 afterward
(Calendar feeds section in `Settings.tsx`, and `WalmartHandoff.tsx` +
`GroceryBoard.tsx` for Share list). That's the actual unaudited surface — scope
the check to it instead of re-reviewing pages upstream already hardened.

**How:** stack live at http://localhost:8080 with seeded content, Playwright
via `npx playwright` (chromium), admin token injected as in the ground rules.
Screenshot only: `/settings?tab=appearance` (palette cards + sun-pref control),
`/settings?tab=smarthome`, `/settings?tab=calendars` (Calendar feeds
add/list/edit rows), and the grocery list's Share-list flow (`GroceryBoard` →
`WalmartHandoff` unconfigured state: share view, copy, QR code) — each in both
themes (`localStorage 'waffled:theme'` = 'light' / 'dark'). Save PNGs to the
scratchpad. Review each for unreadable text, invisible borders, stuck-light
surfaces (hardcoded hex instead of tokens), broken chip/pill/badge contrast.
Fix root causes in the CSS token layer (`apps/web/src/styles/*.css`) over
per-component overrides.

**Verify:** before/after screenshots for anything fixed; web suite green.

**Done when:** the four fork-added surfaces above are reviewed in both themes,
any fixes merged + pushed + CI green, and a short findings note (per-surface
OK/fixed list) appended below this item.

---

## P4.5 — Clearly visible fork version (user request 2026-07-20)

- [x] **Surface a distinct fork version in the app, alongside the upstream base.**
  - *Result (2026-07-21): shipped as 44b55ccd — FORK_VERSION (git describe) baked
    into the image (waffled script → compose args → Dockerfile, api + migrate),
    member-visible GET /api/version, About panel headline + upstream base/build
    time, System Health build line, fork-aware update notifier (points at merging
    upstream, not ./waffled upgrade). UPDATE_CHECK_REPO flipped to
    kevinpsites/waffled in the live .env so "latest is vX.Y.Z" tracks upstream.
    TDD: api 912/912, web 473/473, tsc clean both. Live-verified after
    update.ps1 -Force. Follow-up in the same item (f71888ca): the upstream-repo
    flip surfaced upstream's app-wide UpdateModal telling the operator to run
    ./waffled upgrade — made fork-aware (merge-upstream guidance, no one-command
    upgrade, no How-to-upgrade link) with a TDD'd component test.*

**Why:** the user checked Settings and could only find "0.8.0" — which is the
upstream base version, indistinguishable from vanilla upstream. The fork deploys
nightly from `main` with no visible identity of its own, the About panel is
literally a "Version and storage info land here" placeholder, and the update
checker 404s (UPDATE_CHECK_REPO points at the fork repo, which has no releases).

**How:** the fork version is `git describe --tags --always` — e.g.
`v0.8.0-145-g18dc02d3` = upstream base + fork commits ahead + sha. Auto-derived,
never hand-bumped. Mirror the existing GIT_SHA plumbing end to end:
- `waffled` script (~line 62, next to GIT_SHA): export
  `FORK_VERSION="$(git -C "$ROOT" describe --tags --always 2>/dev/null || echo dev)"`.
- `infra/compose/docker-compose.yml`: pass `FORK_VERSION: ${FORK_VERSION:-dev}`
  as a build arg on the same services that get GIT_SHA (api ~line 46, +migrate
  ~line 67 — the 0ee64bfa provenance-race fix means BOTH need it).
- `apps/api/Dockerfile`: `ARG FORK_VERSION=dev` → `ENV` (next to GIT_SHA ~line 28).
- `apps/api/src/platform/version.ts`: add `fork: process.env.FORK_VERSION || 'dev'`;
  flows into `/api/health` version block and `/api/updates` `current`.
- Web: finish the About placeholder (`Settings.tsx` AboutPanel ~line 2537) —
  fork version prominent, "upstream base 0.8.0 · built <time>" beneath. Also
  append the fork version to the System Health build line (~line 524) and show
  it in the UpdateBanner "Running …" lines.
- KEEP `package.json` at upstream parity (0.8.0) — it feeds the update checker's
  semver compare; the fork version is display-only provenance, not a semver.
- On the live stack (user-local `infra/compose/.env`, never committed): flip
  `UPDATE_CHECK_REPO` to `kevinpsites/waffled` so "latest is vX.Y.Z" reflects
  upstream releases. Reword the UpdateBanner upgrade hint (`Settings.tsx` ~548):
  for a fork, "upstream has a newer release — merge it" — running
  `./waffled upgrade` onto upstream images would drop the fork features.
- NOTE: `.github/workflows/publish-images.yml` also passes GIT_SHA (~line 101)
  and would need FORK_VERSION for GHCR builds — but workflows are untouchable
  (token scope). Fine: GHCR images fall back to 'dev'; the kiosk builds from
  source via `./waffled up --build` so it always gets the real value. Add the
  one-line workflow edit to the user-blocked list below.

**Verify (TDD):** api test — version payload includes `fork` and `/api/updates`
`current.fork` (set the env var in the test); web test — AboutPanel renders the
fork version and upstream base from the health/updates payload; typecheck both.

**Done when:** tests green, merged, pushed, CI green, CHANGELOG entry, and after
a `.\update.ps1 -Force` (or the nightly run) Settings → About on the live kiosk
shows a `v0.8.0-<n>-g<sha>` fork version.

---

## P5 — Documentation debt for all six fork features

- [x] **Bring the docs site + roadmap in line with what the fork actually does.**
  (Repo rule: "a feature isn't done until users could find and understand it.")
  - *Result (2026-07-21): shipped as 6737d3ca (13 files, +594) — NEW
    administration/outlook-calendar.md (Azure registration, work-account admin
    consent w/ ICS plan-B framing, AADSTS troubleshooting from git history),
    features/smart-home.md, features/voice.md, guides/android-phones.md (PWA +
    TWA — apps/android-twa exists); UPDATED calendar.md (ICS feeds section),
    appearance.md (sunset night dim), lists.md (Share list), env-variables (MS_*
    + ICS_SYNC_INTERVAL_MS, defaults verified against config.ts), features
    matrix (+4 fork rows), roadmap (Fork additions ✅ + wake word deferred),
    README reality pass. Astro build green (56 pages). Also fixed three FALSE
    CHANGELOG claims found during sourcing: Fully-Kiosk backlight (overlay only
    — setScreenBrightness never called), wake word "can be enabled" (deferred),
    PWA shortcuts (Today/Grocery/Calendar, not Capture). Gaps → P9.*

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

## P8 — Merge upstream v0.9.0 (discovered 2026-07-21)

- [ ] **Merge `upstream/main` (v0.9.0, published 2026-07-20) into fork `main`.**

**Why:** the update checker's very first run against upstream (P4.5) found
v0.9.0, published hours after our v0.8.0 merge landed. Same rationale as P1 —
the sooner it's merged the cheaper it is. NOTE: sequenced after P5–P7 because
the docs sweep (P5) is fork-state cleanup that predates this, but the USER may
prefer to bump this ahead — ask if unsure, or bump it if P6/P7 look likely to
conflict with upstream's changes.

**How:** the P1 playbook verbatim (fetch upstream, branch `merge/upstream-v0.9.0`,
expected conflict hotspots listed under P1 — plus the new fork surfaces since:
`apps/api/src/modules/updates/updates.ts` (/api/version route + fork field),
`apps/web/src/kiosk/components/UpdateModal.tsx` (fork-aware copy),
`apps/web/src/lib/powersync/*` + Settings System Health (sync watchdog),
`apps/api/src/modules/calendar/ics-feeds.ts` + migration 0102 (check upstream
didn't claim 0102). Read upstream's v0.9.0 release notes/changelog FIRST and
scan for: renamed calendar internals, new migrations, UpdateModal/version
changes (upstream may have built its own /api/version — reconcile, upstream
wins on structure).

**Verify:** P1's verify list (tsc both apps, full web + api suites, migration
hygiene check) + the fork smoke: Appearance tab, Smart Home in Modules, Connect
Outlook button, Calendar feeds section, About fork version, Share list.

**Done when:** merged, pushed, CI green, `.\update.ps1 -Force` spot-check shows
the fork features + About now reads `v0.9.0-<n>-g<sha>`.

---

## P9 — Small fork polish (gaps found during the P5 docs pass)

- [ ] **Close the truth gaps the documentation sourcing uncovered.** Three small,
  independent TDD items (one branch is fine):
  1. **ICS feeds Settings UI is missing two API-backed controls** — the API
     accepts `visibility` on POST/PATCH `/api/calendar/feeds` and has
     POST `/feeds/:id/sync`, but `CalendarFeedsCard` in
     `apps/web/src/kiosk/Settings.tsx` exposes neither a Private toggle nor a
     manual Sync-now button (and last_error surfacing is worth checking). Add
     them following the calendar-row UI patterns; then update calendar.md's
     hedged wording ("a feed can also be marked personal") to name the controls.
  2. **Wire the real Fully Kiosk backlight into night dim** —
     `apps/web/src/lib/fully.ts` has `setScreenBrightness` but nothing calls it;
     night dim is a CSS overlay (`.kiosk-dim`). Drive the backlight on the dim
     schedule when running under Fully Kiosk (feature-detect), restore on wake.
     Then un-hedge the CHANGELOG line and appearance.md's Fully note.
  3. **(check first)** CHANGELOG says the STT choice is "set on the server" —
     if a Settings surface showing the active STT backend is cheap (read-only
     line in AI & Capture), add it; otherwise leave as-is.

---

## Explicitly NOT in this backlog (blocked on the user / other machines)

- **Restore upstream's improved ci.yml** — the v0.8.0 merge deliberately kept the fork's
  older `.github/workflows/ci.yml` because the gh token can't push workflow files. Upstream's
  version adds a CLI-test job, splits the slow e2e into its own job, and runs the api suite
  on the new fast harness. Two ways to fix (either takes ~2 min): run
  `gh auth refresh -h github.com -s workflow` and tell Claude to push it, OR on github.com
  open the fork's `.github/workflows/ci.yml` → edit → paste the contents of upstream's
  version (github.com/kevinpsites/waffled/blob/main/.github/workflows/ci.yml) → commit.
  Until then CI runs the old layout (no CLI tests, no e2e job in CI; e2e still runnable
  locally via `npm run test:e2e` in apps/api).

- **Add FORK_VERSION to publish-images.yml** (once P4.5 lands) — same workflow-scope
  problem as above; the GHCR builds need `FORK_VERSION=$(git describe --tags --always)`
  passed as a build arg next to GIT_SHA (~line 101) or GHCR images report fork version
  'dev'. Harmless for the kiosk (it builds from source) but worth the one-line fix
  whenever the token gets workflow scope.

- Outlook work-account connect — waiting on OIT approval; retry is a user click.
- ~~Google Calendar OAuth client~~ — DONE (verified 2026-07-20): GOOGLE_* wired
  into infra/compose/.env, account connected, primary calendar syncing with no
  errors. Note: several calendars on the account exist but aren't selected for
  sync — enabling them is a user choice in Settings → Calendars.
- Fully Kiosk PLUS purchase/config, tablet install, wake-word mic tests — user hardware.
- HTTPS for tablet mic (Tailscale/hostname mode) — needs user network decisions.
- HA device onboarding — needs the family's actual device brands/accounts.
- iOS work (incl. iOS dark mode) — no Xcode on this Windows machine.
