# Kiosk lock screen — design

**Status:** approved in chat 2026-10-09 · **Scope:** web kiosk only (iPad later)

## Problem

Kids walk up to the counter tablet and add, delete and tap things. The existing per-person
PIN only guards *claiming a profile* on the picker; once a session is open (or a kid has a
PIN-less profile), anyone can do anything. We want a household **4-digit lock code** that
stops all interaction on a paired kiosk until a grown-up enters it.

## Decisions (from the brainstorm)

| Question | Answer |
|---|---|
| What can kids do while locked? | **Look, don't touch** — the screen stays visible; any tap opens the keypad. |
| How does it re-lock? | **Idle timer + a 🔒 lock-now button.** Also locks when the screensaver starts and on page load. |
| Platforms | **Web kiosk only** (paired devices). Personal phones / normal browser sessions never lock. |
| Where is the code? | **One household code, hashed server-side** (same scrypt as passwords/PINs), checked by the server with the same throttle as profile PINs. |

## Server (`apps/api`)

- Migration `0104_kiosk_lock.sql`: `households.kiosk_lock_hash text`,
  `kiosk_lock_failed_count int not null default 0`, `kiosk_lock_locked_until timestamptz`.
  The hash lives in its own column — **not** in `settings.display`, which is served to the
  device — so it never leaves the server.
- Display settings gain `lock: { enabled: boolean; idleMinutes: number }` (defaults
  `false`, `3`; `idleMinutes` clamped 1–60). Reads add a computed `lock.hasCode`; it is
  never persisted into the jsonb.
- `PUT /api/kiosk/lock-code { code }` — admin only; exactly 4 digits (400 otherwise);
  resets the throttle.
- `DELETE /api/kiosk/lock-code` — admin only; clears hash + throttle.
- `POST /api/kiosk/unlock { code }` — dual-auth (device or profile token, household
  resolved like `GET /display`). 200 `{ ok: true }` on match; 401 `{ triesLeft }` on a miss;
  429 `{ retryAfter }` once `KIOSK_PIN_MAX_ATTEMPTS` misses accumulate (lasts
  `KIOSK_PIN_LOCKOUT_SECONDS`), and the correct code is refused while locked out. 409 when
  no code is set.

## Web (`apps/web`)

- `KioskLock` (new, `kiosk/KioskLock.tsx`) rendered by `DisplayLayer` only when
  `isKioskMode() && cfg.lock.enabled && cfg.lock.hasCode`.
  - Locked: a transparent full-screen shield over the app *and* the profile picker. Any
    tap opens a keypad in a `.modal-overlay`; keydown is swallowed in the capture phase.
  - Keypad: the existing `PinPad` keypad, extracted into a shared `Keypad` so both the
    profile PIN and the lock use one component (4 digits for the lock).
  - Re-lock: after `lock.idleMinutes` of no input, when the screensaver comes up, and on
    mount (a reload starts locked). A small floating 🔒 button locks immediately.
- Settings → Display & Kiosk: a **Lock screen** row inside the existing card — toggle,
  idle-minutes select, Set / Change / Remove code (admin only). Stays inside upstream's
  container per the fork rule.
- Forgotten code: an admin on any signed-in device can change or remove it in Settings.

## Testing

- API integration (`kiosk.integration.test.ts`): set/remove (admin-only, 4-digit
  validation), unlock success, 401 tries-left, 429 lockout + correct code refused while
  locked, 409 without a code, device-token unlock, hash never served, `lock` settings
  persist/clamp and `hasCode` reflects the column.
- Web unit (`KioskLock.test.tsx`): starts locked, tap opens keypad, correct code unlocks,
  wrong code shows tries-left, idle re-locks, lock-now button, inactive when no code.
- Playwright drive of the running kiosk for visuals.

## Out of scope

iPad native lock; per-device codes; a master/recovery code on the tablet.
