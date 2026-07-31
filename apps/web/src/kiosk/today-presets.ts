// One-tap starting layouts for the Today Customize view. Each is a full
// StoredLayout (zone tree) the user can apply, then tweak — split/resize
// zones, drag cards — and save.
import type { StoredLayout } from '../lib/api'
import { isLeaf, type ZoneNode } from './zone-layout'

export interface TodayPreset {
  id: string
  label: string
  sub?: string
  layout: StoredLayout
}

export const TODAY_PRESETS: TodayPreset[] = [
  {
    id: 'calendar-top',
    label: 'Calendar on top',
    sub: 'Week calendar full-width, cards below',
    layout: {
      zones: {
        dir: 'col',
        children: [
          { cards: ['weekCalendar'], size: 1 },
          { dir: 'row', children: [{ cards: ['agenda', 'countdowns'] }, { cards: ['tonight', 'week'] }, { cards: ['chores', 'grocery'] }] },
        ],
      },
      hidden: [],
    },
  },
  {
    id: 'classic',
    label: 'Classic columns',
    sub: 'Three even columns, no band',
    layout: {
      zones: { dir: 'row', children: [{ cards: ['agenda', 'countdowns', 'weekCalendar'] }, { cards: ['tonight', 'week'] }, { cards: ['chores', 'grocery'] }] },
      hidden: [],
    },
  },
  {
    id: 'agenda-focus',
    label: 'Agenda focus',
    sub: 'A wide agenda beside the rest',
    layout: {
      zones: {
        dir: 'col',
        children: [
          { cards: ['weekCalendar'], size: 1 },
          { dir: 'row', children: [{ cards: ['agenda'], size: 1.6 }, { cards: ['chores', 'grocery'], size: 1 }, { cards: ['tonight', 'week', 'countdowns'], size: 1 }] },
        ],
      },
      hidden: [],
    },
  },
  {
    id: 'meals-focus',
    label: 'Meals focus',
    sub: 'Dinners and grocery up front',
    layout: {
      zones: { dir: 'row', children: [{ cards: ['tonight', 'week', 'grocery'] }, { cards: ['agenda', 'countdowns'] }, { cards: ['chores', 'weekCalendar'] }] },
      hidden: [],
    },
  },
  {
    id: 'quadrants',
    label: 'Quadrants',
    sub: 'Four zones in a 2×2 grid',
    layout: {
      zones: {
        dir: 'col',
        children: [
          { dir: 'row', size: 1.4, children: [{ cards: ['weekCalendar'] }, { cards: ['agenda'] }] },
          { dir: 'row', children: [{ cards: ['tonight', 'week', 'grocery'] }, { cards: ['chores', 'countdowns'] }] },
        ],
      },
      hidden: [],
    },
  },
  {
    id: 'sidebar',
    label: 'Sidebar',
    sub: 'One big zone with a stacked sidebar',
    layout: {
      zones: {
        dir: 'row',
        children: [
          { cards: ['weekCalendar', 'agenda'], size: 2.4 },
          { dir: 'col', size: 1, children: [{ cards: ['tonight', 'week'] }, { cards: ['chores', 'grocery', 'countdowns'] }] },
        ],
      },
      hidden: [],
    },
  },
]

// Apply a preset filtered to the household's available cards — a card whose
// module is off is dropped so the preset never places something that would just
// get stripped. The server's reconcile appends any always-on card the preset
// happened to omit, so nothing is ever lost.
export function applyPreset(preset: TodayPreset, isAvailable: (card: string) => boolean): StoredLayout {
  const filter = (n: ZoneNode): ZoneNode =>
    isLeaf(n) ? { ...n, cards: n.cards.filter(isAvailable) } : { ...n, children: n.children.map(filter) }
  return { zones: filter(preset.layout.zones), hidden: preset.layout.hidden ?? [] }
}
