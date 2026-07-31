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
  default it spans a **full-width zone across the top** of the board — drag it anywhere,
  or hide it, in Customize. Days show as **distinct bordered cells** (today's
  ringed) by default; **Settings → Family → Week calendar → Continuous** switches to a
  plainer, borderless look. **Person chips** above the strip filter the week to the
  people you pick (same chips as the calendar's Week view) — the selection is
  **remembered on that device**, so the wall kiosk keeps its filter. Events happening
  **right now** breathe with a gentle pulse and a live dot (a static ring under
  reduced-motion settings).
- 🧱 **Zones** (web) — the board is a grid of **zones**, PowerToys-FancyZones style:
  any zone can be **split** into side-by-side or stacked zones, **deleted** (its cards
  slide into the neighbor), and **resized** by dragging the dividers between zones.
  Cards stack inside their zone; the week calendar gets a full-width top zone by
  default. While you drag a card, the zone under your finger **lights up** so you can
  see exactly where it will land.
- 🎯 **Goals card** — shows one goal's progress; pick **My spotlight**, **Family
  spotlight**, or a **specific goal** from a grouped picker. See [Goals](/features/goals/).
- ⭐ **Rewards card** (web) — every member's star balance at a glance, a "waiting for
  approval" note when redemptions are pending, and a **Shop ›** jump into the
  [Reward Shop](/features/rewards/). Appears automatically when rewards are enabled;
  move or hide it like any card.
- ✋ **Drag cards right on the board** (web) — press and **hold a card ~half a second**
  and it lifts; drag it to any zone (the target highlights) and drop, and the layout
  saves as **your personal layout** automatically. **Resize zones the same way** — drag
  the faint dividers between zones right on the dashboard; that saves automatically too.
  A finger that moves early scrolls instead of lifting, and buttons inside cards are
  never drag handles — so the board can't be rearranged by accident. For editing zones,
  hiding cards, presets, or resetting, use Customize mode.
- 🔇 **Signal-to-noise controls** (web, in Customize → *Board options*):
  - **Hide empty cards** — a card with nothing to show (no events today, empty grocery
    list, no chores…) collapses away entirely and reappears the moment it has content.
    Customize always shows everything so nothing gets lost.
  - **Density** — **Cozy** (default) or **Compact**, which tightens padding, headers,
    and gaps so more fits with less visual weight.
  - **Per-card quiet settings** — the ⚙ on a card's Customize chip: the Agenda can
    **hide already-ended events**, the Grocery card can **cap its list at N items**
    (with a "+N more" tail), and Chores can **hide "up for grabs"** chores.
- 🎛️ **Customize mode** (web / iPhone):
  - **drag** a card by its bar to reorder; each card also has an **× to hide it** —
    hidden cards drop into a tray below the board where a tap adds them back
  - **edit zones** (web) — every zone shows a small toolbar: **split ↔** (side-by-side),
    **split ↕** (stacked), and **×** to delete the zone (its cards merge into the
    neighbor; the last zone can't be deleted)
  - **layout templates** (web) — one tap on **Calendar on top**, **Classic columns**,
    **Agenda focus**, **Meals focus**, **Quadrants** (a 2×2 grid), or **Sidebar** (one
    big zone + a stacked rail) fills the board with that arrangement to tweak and save
  - **resize zones** (web) — draggable dividers between zones (widths as ratios,
    heights for pinned zones like the calendar strip); the sizes save with your layout.
    The handles also live **right on the normal dashboard** (faint until you hover/grab
    them) — a drag there saves to your personal layout automatically, like moving a card
  - save the layout **"for me"** (per-user) or **"for everyone"** (family default);
    your arrangement, zones, board options, **and** which cards you've hidden all save
    per person — an old saved layout converts to zones automatically
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
