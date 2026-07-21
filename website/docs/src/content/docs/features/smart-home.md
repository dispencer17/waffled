---
title: Smart Home (Home Assistant)
description: Connect your own Home Assistant, pin the devices that matter, and give the whole family one-tap control from the Today card — the token stays on the server, encrypted.
---

Smart Home turns the kitchen kiosk into a light switch. Connect Waffled to your own
**Home Assistant** instance, pin the handful of devices the family actually touches —
the kitchen lights, the porch light, a "Movie night" scene — and a **Smart Home card on
Today** gives everyone one-tap control of exactly those devices and nothing else. Waffled
never talks to a cloud; it talks to your HA server, and your HA token never leaves yours. 💡

## Highlights

- 🔗 **Bring your own Home Assistant** — point Waffled at your HA URL with a long-lived
  access token; the token is stored **encrypted at rest** on the server and never shown again.
- 📌 **Pinned devices are a real allowlist** — only pinned devices appear on the Today card,
  and only pinned devices *can* be controlled; the server refuses anything else.
- ⚡ **One-tap quick controls on Today** — lights, switches, and fans toggle instantly
  (with an optimistic flip); scenes, scripts, and buttons fire with a tap.
- 🔒 **Locks are read-only** — a lock shows locked/unlocked state but deliberately has no
  tap action.
- 🎙️ **Voice-controllable** — "turn off the kitchen lights" works through the
  [voice assistant](/features/voice/), against the same pinned allowlist.
- 🛡️ **Server-side proxy** — the browser never talks to HA directly; every call goes
  through the Waffled API, so the HA token never reaches a kiosk or phone.

## Connecting Home Assistant

**Settings → Smart Home** (admin-only) is the whole setup:

1. Enter your **HA URL** (e.g. `http://homeassistant.local:8123`).
2. Paste a **long-lived access token** — create one in Home Assistant under your profile →
   **Security → Long-lived access tokens**.
3. **Save & test** — the connection pill flips to **Connected** with your HA instance's
   name and version, or tells you what's wrong (unreachable, or "unauthorized — check the
   token").

The token is write-only: it's encrypted at rest on the server (this needs
`TOKEN_ENCRYPTION_KEY` set — the same key that protects calendar refresh tokens) and is
never echoed back to any browser. To rotate it, just paste a new one.

## Pinning devices

Once connected, the **Pinned devices** card in the same panel lists everything controllable
that HA knows about — lights, switches, fans, scenes, scripts, locks, covers, climate, and
buttons — and an admin checks the ones the family should see.

The pin list is a **guardrail, not a display filter**: unpinned entities never appear on
Today, and a request to control one is rejected by the server outright. That keeps a
wall-mounted tablet (or a curious kid) from reaching the garage door opener you didn't
intend to expose.

## Quick controls on Today

Every family member gets the pinned devices as a card on the Today dashboard:

- **Lights, switches, fans** — tap to toggle; the tile flips immediately and re-checks the
  real state a moment later.
- **Scenes, scripts, buttons** — show **Run** and fire on tap.
- **Locks** — show 🔒/🔓 state only; no tap action, by design.
- **Climate, covers, sensors** — display their state.

The card refreshes on its own every few seconds, so a light flipped from the wall switch or
the HA app shows up without touching Waffled.

## What about Alexa devices?

Waffled talks to **Home Assistant, not Alexa** — there's no Alexa or cloud integration in
Waffled itself. If a device today lives in your Alexa app (a smart plug, a bulb), the path
is to **bridge it into Home Assistant**: add the device to HA through one of HA's
integrations, and once HA can control it, Waffled can too — pin it like anything else.
Alexa keeps working alongside; Waffled just goes through HA's view of the device.

## Where it works

| Surface | Support |
|---|---|
| Web / Kiosk | ✅ |
| iPhone | ❌ |
| iPad | ❌ |

Smart Home is web/kiosk-only: the Today quick-controls card and the Settings panel live in
the web app. The iOS apps don't show the card.

## Settings

**Settings → Smart Home** — the connection (URL + token) and the pinned-device picker, both
admin-only. Any member can *use* the Today card; only the pin list decides what's on it.

## Module

Smart Home is an **optional module** (`smartHome`, default **off**), toggled in
**Settings → Modules**. With the module off, the Today card, the Settings panel, and the
voice commands all stay dark.

## Notes

- 🛡️ **The token never reaches the browser.** All HA traffic is proxied through the Waffled
  API; kiosks and phones only ever see the pinned entities' names and states.
- 🔐 **Encryption is required to save a token** — set `TOKEN_ENCRYPTION_KEY` in the server
  env (the Docker install's `.env` covers this) or saving the connection fails.
- 🌐 **Waffled's server must be able to reach your HA URL** — they typically share a LAN or
  a Docker network; a browser-only route to HA isn't enough.
- 🎙️ **Voice control respects the same allowlist** — a spoken "turn on the porch light" can
  only ever match a pinned device. See [Voice assistant](/features/voice/).
