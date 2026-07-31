// The Customize layout presets (zone trees) + their application against module
// availability.
import { describe, it, expect } from 'vitest'
import { TODAY_PRESETS, applyPreset } from './today-presets'
import { isLeaf, listLeaves } from './zone-layout'

// Mirror of the kiosk card registry keys (CARDS in Today.tsx).
const KNOWN = ['agenda', 'tonight', 'week', 'chores', 'rewards', 'grocery', 'countdowns', 'familyNight', 'goals', 'pantry', 'smartHome', 'weekCalendar']

const cardsOf = (p: (typeof TODAY_PRESETS)[number]) => listLeaves(p.layout.zones).flatMap((l) => l.leaf.cards)

describe('TODAY_PRESETS', () => {
  it('has unique ids and non-empty labels', () => {
    const ids = TODAY_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(TODAY_PRESETS.every((p) => p.label.length > 0)).toBe(true)
  })

  it('references only known cards', () => {
    for (const p of TODAY_PRESETS) {
      for (const c of [...cardsOf(p), ...(p.layout.hidden ?? [])]) expect(KNOWN).toContain(c)
    }
  })

  it('offers the classic, calendar-on-top, and FancyZones-style grid templates', () => {
    const ids = TODAY_PRESETS.map((p) => p.id)
    expect(ids).toContain('classic')
    expect(ids).toContain('calendar-top')
    expect(ids).toContain('quadrants')
    expect(ids).toContain('sidebar')
  })

  it('the classic preset has no pinned band; calendar-on-top pins the calendar on top', () => {
    const classic = TODAY_PRESETS.find((p) => p.id === 'classic')!
    expect(isLeaf(classic.layout.zones)).toBe(false)
    if (!isLeaf(classic.layout.zones)) expect(classic.layout.zones.dir).toBe('row')
    const top = TODAY_PRESETS.find((p) => p.id === 'calendar-top')!
    expect(listLeaves(top.layout.zones)[0].leaf.cards).toEqual(['weekCalendar'])
    expect(listLeaves(top.layout.zones)[0].leaf.size).toBeDefined() // pinned height
  })

  it('quadrants is a 2×2 grid of leaves', () => {
    const quad = TODAY_PRESETS.find((p) => p.id === 'quadrants')!
    expect(listLeaves(quad.layout.zones)).toHaveLength(4)
  })
})

describe('applyPreset', () => {
  const preset = TODAY_PRESETS.find((p) => p.id === 'calendar-top')!

  it('keeps all cards when everything is available', () => {
    const out = applyPreset(preset, () => true)
    expect(listLeaves(out.zones)[0].leaf.cards).toEqual(['weekCalendar'])
    expect(listLeaves(out.zones).flatMap((l) => l.leaf.cards)).toContain('tonight')
  })

  it('drops cards whose module is off', () => {
    const out = applyPreset(preset, (c) => c !== 'tonight' && c !== 'week')
    const cards = listLeaves(out.zones).flatMap((l) => l.leaf.cards)
    expect(cards).not.toContain('tonight')
    expect(cards).not.toContain('week')
    expect(cards).toContain('weekCalendar') // the never-gated calendar survives
  })

  it('carries a preset own zone sizes through', () => {
    const focus = TODAY_PRESETS.find((p) => p.id === 'agenda-focus')!
    const out = applyPreset(focus, () => true)
    expect(listLeaves(out.zones)[1].leaf.size).toBe(1.6) // the wide agenda zone
  })
})
