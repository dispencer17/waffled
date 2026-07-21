---
title: Appearance, dark mode & color themes
description: Light or dark, plus eight color themes — pick a look per device from Settings → Display & Kiosk.
---

Waffled ships with a **warm dark theme** alongside the original light one, and **eight color
themes** that re-hue the whole app. On the web, pick how it looks from **Settings → Display &
Kiosk** — the appearance controls sit at the top of that tab, above the kiosk options. (They
used to be a standalone *Appearance* tab; old links land in the right place.) On iPhone/iPad
the same choice lives under **Settings → Appearance**.

Everyone in the family can open Display & Kiosk to set the theme — only the kiosk and
screensaver configuration further down is admin-only.

## Choosing light or dark
- **Light** — the warm-white canvas Waffled has always had.
- **Dark** — a *warm* dark: soft charcoals rather than cold black-and-blue.
- **Match system** — follow your device's own light/dark setting automatically, including when
  it flips on a schedule (e.g. sundown).
- **Follow the sun** — dark from sunset to sunrise using your household location's sun times
  (the same ones the weather uses). Great for a kitchen kiosk.

Every choice on this page **saves on that device only** and applies **instantly** — no reload,
no server round-trip. Set it once on the kitchen kiosk and once on your phone; they're
independent.

## Night dimming can follow the sun too

The kiosk's **Night dimming** schedule (further down in Display & Kiosk, admin-only) learned
the same trick: with dimming on, flip **"Sunset to sunrise"** and the dim window follows your
household location's sun times instead of fixed hours — so it tracks the seasons on its own.
Turn the toggle off to go back to a fixed from → to window. Until the first weather fetch
delivers sun times, the window falls back to fixed overnight hours.

Waffled's dim is an on-screen overlay — a web page can't turn down a tablet's actual
backlight. If you want **real screen-backlight dimming**, run the kiosk in **Fully Kiosk
Browser** on the tablet (Android/Fire tablets; its PLUS license with the JavaScript interface
enabled is what exposes true brightness control to a web app).

## Color themes
Pick a palette under **COLOR THEME**:

| Theme | Feel |
|---|---|
| 🧇 Golden Waffle | The classic — warm cream & coral (the default) |
| 🦩 Flamingo | Playful pink with a rosy glow |
| 🍒 Cherry Sundae | Bold cherry red, whipped-cream white |
| 🍯 Honey | Amber and golden toast |
| 🍵 Matcha | Calm leafy green |
| 🌊 Tide Pool | Cool teal & sea glass |
| 🫐 Blueberry | Crisp blue on a cool canvas |
| 🪻 Lavender | Soft violet, a little dreamy |

A color theme changes the **accent color** (buttons, highlights, the selected state) and gives
every surface — canvas, rails, panels — a **subtle wash of the hue**, in both light and dark.
It deliberately does **not** touch each family member's **personal color**, the **gold** stars,
or the success/warning/danger status colors, so people and states stay recognizable in every
theme.

Color theme and light/dark are independent: Blueberry-dark, Matcha-light, any combination works.

## What "warm dark" means
Dark mode isn't just an inversion. Only two things really change:

- **Surfaces and text** move to warm charcoals — the canvas gets darker than the cards, so
  raised surfaces still read as raised (elevation is preserved, just inverted).
- **Pale tints** (the soft backgrounds behind a person's name, a status pill, an AI chip)
  become low-opacity **washes** of the same color instead of solid pastels.

Everything else — the **coral** primary, the **gold** stars, the **violet** AI accent, and each
family member's **personal color** — stays exactly the same in both themes. That's deliberate:
keeping the accent hues fixed is what makes the app still feel like Waffled with the lights off.

Calendar event chips adapt too: their text is mixed toward the theme's ink — richer and darker
on light, a bright pastel on dark — so every person's events stay readable in both modes.

## Where it works
| Surface | Support |
|---|---|
| Web / Kiosk | ✅ |
| iPhone / iPad | ✅ dark mode (color themes are web/kiosk-only for now) |

Dark mode is available on the web, the kitchen kiosk display, and the iPhone/iPad app. The phone
and iPad mirror the exact same warm-dark palette from their own **Settings → Appearance** control
(Light / Dark / Match system, saved per device), so a screen reads the same with the lights off on
your phone as it does on the wall. The color themes currently apply on the web and kiosk only.

## Notes
- **Match system** uses your device/browser's `prefers-color-scheme`; no account setting is
  involved, so each device can differ.
- Because the preference lives on the device, signing in as a different family member on the
  same kiosk keeps that kiosk's chosen theme and color.
