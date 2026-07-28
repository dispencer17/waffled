---
title: Today dashboard
description: The at-a-glance home screen — agenda, tonight's meal, this week, chores, and grocery.
---

![The Waffled Today dashboard — the day’s events, family chores, tonight’s dinner, pantry and countdowns at a glance](/screenshots/today.png)

Today is the home screen — the at-a-glance view your family lands on: what's on the
[calendar](/features/calendar/), what's for dinner, how the week looks, whose chores
are left, and what's on the grocery list. Like Calendar, it is **never gated** — it's
always there, whatever modules you've turned on.

## Highlights
- **The cards** — agenda · tonight's meal · this week · chores rings · grocery, plus
  **module cards** ([Pantry](/administration/modules/), Family Night,
  [Countdowns](/features/countdowns/), [Goals](/features/goals/)) that appear only when
  their module is on.
- 🗓️ **Week calendar card** (web) — a glanceable week strip: seven day columns starting
  on the household's week-start day, today's date ringed, every event a **solid block in
  its person's color** with a compact time ("1p"), all-day events pinned on top. Tap an
  event to open it, tap a day header for the full [calendar](/features/calendar/). By
  default it spans the **full-width band across the top** of the board — drag it into a
  column, or hide it, in Customize.
- 🧱 **Full-width band + columns** (web) — the board is a full-width **band** on top over
  three **columns**. Drag any card up into the band to span the whole width, or back down
  into a column. The week calendar lives in the band by default.
- 🎯 **Goals card** — shows one goal's progress; pick **My spotlight**, **Family
  spotlight**, or a **specific goal** from a grouped picker. See [Goals](/features/goals/).
- ✋ **Drag cards right on the board** (web) — press and **hold a card ~half a second**
  and it lifts; drag between the band and columns and drop, and the layout saves as **your
  personal layout** automatically. A finger that moves early scrolls instead of lifting,
  and buttons inside cards are never drag handles — so the board can't be rearranged by
  accident. For hiding cards, resizing zones, presets, resetting, or saving for everyone,
  use Customize mode.
- 🎛️ **Customize mode** (web / iPhone):
  - **drag** a card by its bar to reorder; each card also has an **× to hide it** —
    hidden cards drop into a tray below the board where a tap adds them back
  - **layout presets** (web) — one tap on **Calendar on top**, **Classic columns**,
    **Agenda focus**, or **Meals focus** fills the board with that arrangement to tweak
    and save
  - **resize zones** (web) — draggable dividers between the band and the columns (band
    height) and between columns (widths); the handles appear **only while customizing**,
    so the normal dashboard stays uncluttered, and the sizes save with your layout
  - save the layout **"for me"** (per-user) or **"for everyone"** (family default);
    your arrangement, zone sizes, **and** which cards you've hidden all save per person
  - a hidden card **stays hidden** — including module cards (Chores, Meals, Grocery,
    Pantry, Goals, Family Night) that would otherwise reappear when their module is on
  - iPhone keeps a separate mobile `{order, hidden}` config
- 📐 **iPad layout presets** — Balanced / Agenda / Meals / **Goal-focused**; the iPad
  layout is **device-local**.
- ✅ **"Did these happen?"** — the goal recap queue surfaces here.
- 👀 **"Needs your OK"** — the approvals banner surfaces here too.

## Where it works
| Surface | Support |
|---|---|
| Web / Kiosk | ✅ |
| iPhone | ✅ |
| iPad | ✅ |

iPad shows a distinct **3-column dashboard**, and its customization is
**preset-based** rather than drag-to-reorder — the fixed shape suits the wall display.

## Settings
- Layout is configured **in place** — customize mode on the card grid, saved per-user
  or as the family default. There's no separate settings screen for it.
- **Module cards** only appear once their module is enabled in
  [Settings → Modules](/administration/modules/).

## Module
Today itself is **never gated**. Individual **cards** are gated only by their own
module — enable the module and its card shows up; disable it and the card quietly
drops off the dashboard.

## Notes
- The agenda, chores, and grocery cards reflect live data, but only the
  [calendar](/features/calendar/) domain is offline-capable — the other cards need a
  connection to refresh.
