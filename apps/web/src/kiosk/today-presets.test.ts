// The Customize layout presets + their application against module availability.
import { describe, it, expect } from 'vitest'
import { TODAY_PRESETS, applyPreset } from './today-presets'

// Mirror of the kiosk card registry keys (CARDS in Today.tsx).
const KNOWN = ['agenda', 'tonight', 'week', 'chores', 'grocery', 'countdowns', 'familyNight', 'goals', 'pantry', 'smartHome', 'weekCalendar']

describe('TODAY_PRESETS', () => {
  it('has unique ids and non-empty labels', () => {
    const ids = TODAY_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(TODAY_PRESETS.every((p) => p.label.length > 0)).toBe(true)
  })

  it('references only known cards', () => {
    for (const p of TODAY_PRESETS) {
      const cards = [...p.layout.full, ...p.layout.cols.flat(), ...(p.layout.hidden ?? [])]
      for (const c of cards) expect(KNOWN).toContain(c)
    }
  })

  it('offers the classic 3-column and calendar-on-top layouts', () => {
    const ids = TODAY_PRESETS.map((p) => p.id)
    expect(ids).toContain('classic')
    expect(ids).toContain('calendar-top')
  })

  it('the classic preset has no band; calendar-on-top puts the calendar in the band', () => {
    const classic = TODAY_PRESETS.find((p) => p.id === 'classic')!
    expect(classic.layout.full).toEqual([])
    expect(classic.layout.cols.flat()).toContain('weekCalendar')
    const top = TODAY_PRESETS.find((p) => p.id === 'calendar-top')!
    expect(top.layout.full).toEqual(['weekCalendar'])
  })
})

describe('applyPreset', () => {
  const preset = TODAY_PRESETS.find((p) => p.id === 'calendar-top')!

  it('keeps all cards when everything is available', () => {
    const out = applyPreset(preset, () => true)
    expect(out.full).toEqual(['weekCalendar'])
    expect(out.cols.flat()).toContain('tonight')
  })

  it('drops cards whose module is off', () => {
    const out = applyPreset(preset, (c) => c !== 'tonight' && c !== 'week')
    expect(out.cols.flat()).not.toContain('tonight')
    expect(out.cols.flat()).not.toContain('week')
    expect(out.full).toEqual(['weekCalendar']) // the never-gated calendar survives
  })

  it('carries a preset own zone sizes through', () => {
    const focus = TODAY_PRESETS.find((p) => p.id === 'agenda-focus')!
    const out = applyPreset(focus, () => true)
    expect(out.colWidths).toEqual(focus.layout.colWidths)
  })
})
