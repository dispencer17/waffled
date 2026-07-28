// One-tap starting layouts for the Today Customize view. Each is a full
// StoredLayout the user can apply, then tweak (drag cards, resize zones) and save.
import type { StoredLayout } from '../lib/api'

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
    layout: { full: ['weekCalendar'], cols: [['agenda', 'countdowns'], ['tonight', 'week'], ['chores', 'grocery']], hidden: [] },
  },
  {
    id: 'classic',
    label: 'Classic columns',
    sub: 'Three even columns, no band',
    layout: { full: [], cols: [['agenda', 'countdowns', 'weekCalendar'], ['tonight', 'week'], ['chores', 'grocery']], hidden: [] },
  },
  {
    id: 'agenda-focus',
    label: 'Agenda focus',
    sub: 'A wide agenda beside the rest',
    layout: { full: ['weekCalendar'], cols: [['agenda'], ['chores', 'grocery'], ['tonight', 'week', 'countdowns']], hidden: [], colWidths: [1.6, 1, 1] },
  },
  {
    id: 'meals-focus',
    label: 'Meals focus',
    sub: 'Dinners and grocery up front',
    layout: { full: [], cols: [['tonight', 'week', 'grocery'], ['agenda', 'countdowns'], ['chores', 'weekCalendar']], hidden: [] },
  },
]

// Apply a preset filtered to the household's available cards — a card whose
// module is off is dropped so the preset never places something that would just
// get stripped. The server's reconcile appends any always-on card the preset
// happened to omit (to the last column), so nothing is ever lost.
export function applyPreset(preset: TodayPreset, isAvailable: (card: string) => boolean): StoredLayout {
  const l = preset.layout
  return {
    full: l.full.filter(isAvailable),
    cols: l.cols.map((col) => col.filter(isAvailable)),
    hidden: l.hidden ?? [],
    ...(l.bandHeight != null ? { bandHeight: l.bandHeight } : {}),
    ...(l.colWidths ? { colWidths: l.colWidths } : {}),
  }
}
