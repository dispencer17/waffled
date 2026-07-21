---
title: Voice assistant
description: Push-to-talk on the kiosk — set timers, add groceries, flip pinned smart-home devices, and get short spoken answers, with speech-to-text through your own Whisper or OpenAI.
---

Talk to the kiosk. The capture bar grows a **microphone button**: tap it and say "set a
timer for 10 minutes", "add milk to the grocery list", or "turn off the kitchen lights" —
timers ring on the kiosk, groceries land on the list, pinned smart-home devices respond,
and questions get a short spoken answer. Anything more complicated drops into the
[capture bar](/features/capture/) prefilled, so you still get the visual confirm before
the calendar changes. 🎙️

## Highlights

- 🎤 **Push-to-talk** — tap the mic in the "Add anything" bar and speak; recording stops on
  its own when you pause (or on a second tap).
- ⏲️ **Timers** — "set a timer for 10 minutes" starts a countdown that rings on the kiosk.
- 🛒 **Groceries** — spoken items go straight onto the grocery list, several at a time.
- 💡 **Smart home** — control [pinned Home Assistant devices](/features/smart-home/) by
  name; the pinned allowlist applies to voice too.
- ❓ **Questions get spoken answers** — "what's for dinner tonight?" answers in a sentence
  or two from today's agenda and tonight's dinner (needs an AI provider).
- 🗣️ **Replies are spoken aloud** — through Fully Kiosk's native TTS when the kiosk runs in
  Fully (better voices on a Fire tablet), otherwise the browser's own speech synthesis.
- 🏠 **Self-hostable speech-to-text** — run the bundled Whisper container so audio never
  leaves your network, or fall back to OpenAI.

## How a command flows

Tap the mic → speak → the clip is transcribed on your server → the transcript is classified
and executed → the reply is spoken and shown in a small HUD. Recording ends after about a
second and a half of silence, on a second tap, or at a 12-second safety cap.

Simple intents — timers, groceries, smart home, questions — execute immediately. Anything
that changes the calendar, chores, or meals bounces into the capture bar **prefilled with
your words**, keeping the same preview-and-confirm flow as typing.

## Transcription backends

The mic button only appears when the server has a speech-to-text backend. Two choices:

| Backend | Setup | Notes |
|---|---|---|
| **Local Whisper** | Set `WHISPER_BASE_URL` to any OpenAI-audio-compatible server | Audio never leaves your network. The compose stack bundles a CPU [faster-whisper](https://github.com/fedirz/faster-whisper-server) container: `docker compose --profile voice up -d`, then `WHISPER_BASE_URL=http://whisper:8000/v1` (model via `WHISPER_LOCAL_MODEL`, default `Systran/faster-whisper-small`) |
| **OpenAI** | Set `OPENAI_API_KEY` (no `WHISPER_BASE_URL`) | Clips are transcribed with OpenAI's `whisper-1` |

An explicit `WHISPER_BASE_URL` always wins. With neither configured, the mic button is
hidden and voice input is unavailable — everything else in Waffled works normally.

## Understanding what you said

Classification uses the household's **AI provider** (the one from **Settings → AI &
capture**) when configured. Without one, a built-in fallback still covers the highest-value
phrasings — "set a timer for N minutes", "add … to the grocery list", "turn on/off …" —
but open-ended **questions need an AI provider** to get an answer.

Grocery and smart-home commands respect their modules: with [Lists](/features/lists/) or
[Smart Home](/features/smart-home/) turned off, the assistant says so instead of acting.

## Wake word: deferred 🚧

Hands-free "always listening" is **not shipped**. A **Wake word** toggle exists in
**Settings → Display & Kiosk**, wired to the Porcupine engine — but it requires a Picovoice
AccessKey (a third-party account), and it isn't a supported part of Waffled today; treat it
as experimental plumbing. A spike of **openWakeWord** (open-source, no account, runs
locally) is planned as the path to a real hands-free wake word. For now, voice is
push-to-talk: tap the mic.

## Where it works

| Surface | Support |
|---|---|
| Web / Kiosk | ✅ |
| iPhone | ❌ |
| iPad | ❌ |

The voice assistant is web/kiosk-only — it's built for the always-on kitchen tablet. (The
iPhone keyboard's own dictation into the capture bar works as it always has, and dictating
a whole recipe is a separate flow — see
[Add a recipe from a photo or voice](/guides/ai-recipe-import/).)

## Module

Voice is **core — not module-gated**. It appears wherever a speech-to-text backend is
configured; individual commands only land where their module is on (a grocery command needs
[Lists](/features/lists/), a device command needs [Smart Home](/features/smart-home/)).

## Notes

- 🎙️ **The browser needs microphone permission** (and a secure context — HTTPS or
  localhost) for the mic to record at all; see [Reverse proxy & TLS](/install/reverse-proxy/).
- ✂️ **Clips are short by design** — recording caps at 12 seconds and uploads at ~4 MB;
  voice is for commands, not dictation.
- 👨‍👩‍👧 **Any family member can use it** — voice commands run as whoever is signed in on the
  device, and destructive or complex changes still go through the capture bar's confirm step.
- 🔇 **Push-to-talk means no always-on listening** — the mic is only live between your tap
  and the end of the clip. Nothing records in the background unless you deliberately enable
  the experimental wake-word toggle above.
