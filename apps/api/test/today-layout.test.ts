// Pure unit tests for the Today-layout normalization (no DB needed).
import { describe, it, expect } from 'vitest'
import { reconcileLayout, TODAY_CARDS } from '../src/modules/layout/today-layout'

// The built-in default: the week calendar spans the full-width band on top, the
// rest sit in the 3 columns below.
const DEFAULT_FULL = ['weekCalendar']
const DEFAULT_COLS = [['agenda', 'countdowns'], ['tonight', 'week'], ['chores', 'grocery']]

// Every known card appears exactly once across the band + columns.
const placed = (out: { full: string[]; cols: string[][] }) => [...out.full, ...out.cols.flat()]

describe('reconcileLayout', () => {
  it('falls back to the default (calendar in the band) for null / garbage / all-unknown input', () => {
    expect(reconcileLayout(null)).toEqual({ full: DEFAULT_FULL, cols: DEFAULT_COLS, hidden: [] })
    expect(reconcileLayout('nope')).toEqual({ full: DEFAULT_FULL, cols: DEFAULT_COLS, hidden: [] })
    expect(reconcileLayout([['unknown'], ['also-bad']])).toEqual({ full: DEFAULT_FULL, cols: DEFAULT_COLS, hidden: [] })
  })

  it('always returns exactly 3 columns', () => {
    expect(reconcileLayout([['agenda']]).cols.length).toBe(3)
    expect(reconcileLayout([['a'], ['b'], ['c'], ['d'], ['e']]).cols.length).toBe(3)
  })

  it('keeps every card exactly once; missing weekCalendar → band, other missing → last column', () => {
    const out = reconcileLayout([['grocery', 'agenda']])
    expect(placed(out).sort()).toEqual([...TODAY_CARDS].sort())
    expect(out.cols[0]).toEqual(['grocery', 'agenda']) // preserves given order + column
    expect(out.full).toEqual(['weekCalendar']) // the unplaced calendar defaults to the band
    expect(out.cols.flat()).not.toContain('weekCalendar')
  })

  it('keeps a weekCalendar the user placed in a column (does not force it to the band)', () => {
    const out = reconcileLayout({ full: [], cols: [['weekCalendar', 'agenda'], [], []], hidden: [] })
    expect(out.full).toEqual([])
    expect(out.cols[0]).toEqual(['weekCalendar', 'agenda'])
  })

  it('accepts a {full, cols, hidden} shape and keeps band cards out of the columns', () => {
    const out = reconcileLayout({ full: ['weekCalendar'], cols: [['agenda'], [], []], hidden: [] })
    expect(out.full).toEqual(['weekCalendar'])
    expect(out.cols.flat()).not.toContain('weekCalendar')
  })

  it('drops duplicate and unknown keys (across band + columns)', () => {
    const out = reconcileLayout({ full: ['weekCalendar', 'weekCalendar', 'bogus'], cols: [['agenda', 'agenda'], ['weekCalendar'], []], hidden: [] })
    expect(out.full).toEqual(['weekCalendar'])
    expect(out.cols.flat().filter((k) => k === 'agenda').length).toBe(1)
    expect(out.cols.flat()).not.toContain('weekCalendar') // already claimed by the band
    expect([...out.full, ...out.cols.flat()]).not.toContain('bogus')
  })

  it('merges overflow columns (past the 3rd) into the last column', () => {
    const out = reconcileLayout([['agenda'], ['tonight'], ['week'], ['chores'], ['grocery']])
    // cols past the 3rd merge in; unplaced non-calendar cards (in TODAY_CARDS order)
    // append to the last column, and the unplaced calendar goes to the band.
    expect(out.cols[2]).toEqual(['week', 'chores', 'grocery', 'countdowns', 'rewards', 'pantry', 'familyNight', 'goals', 'smartHome'])
    expect(out.full).toEqual(['weekCalendar'])
  })

  it('accepts every card the kiosk registry can place (smartHome, weekCalendar, rewards)', () => {
    expect(TODAY_CARDS).toContain('smartHome')
    expect(TODAY_CARDS).toContain('weekCalendar')
    expect(TODAY_CARDS).toContain('rewards')
    const out = reconcileLayout({ full: ['weekCalendar'], cols: [['smartHome', 'rewards'], [], []], hidden: [] })
    expect(out.full).toEqual(['weekCalendar'])
    expect(out.cols[0]).toEqual(['smartHome', 'rewards'])
  })

  // --- Zone sizes ---------------------------------------------------------

  it('carries a finite bandHeight, clamped to [160, 900]', () => {
    expect(reconcileLayout({ full: ['weekCalendar'], cols: [[], [], []], bandHeight: 320 }).bandHeight).toBe(320)
    expect(reconcileLayout({ full: ['weekCalendar'], cols: [[], [], []], bandHeight: 50 }).bandHeight).toBe(160)
    expect(reconcileLayout({ full: ['weekCalendar'], cols: [[], [], []], bandHeight: 5000 }).bandHeight).toBe(900)
  })

  it('drops a non-numeric / non-finite bandHeight', () => {
    expect(reconcileLayout({ cols: [['agenda'], [], []], bandHeight: 'tall' }).bandHeight).toBeUndefined()
    expect(reconcileLayout({ cols: [['agenda'], [], []], bandHeight: Infinity }).bandHeight).toBeUndefined()
    expect(reconcileLayout({ cols: [['agenda'], [], []] }).bandHeight).toBeUndefined()
  })

  it('carries colWidths only when it is 3 finite positives, each clamped to [0.4, 3]', () => {
    expect(reconcileLayout({ cols: [['agenda'], [], []], colWidths: [1, 2, 1] }).colWidths).toEqual([1, 2, 1])
    expect(reconcileLayout({ cols: [['agenda'], [], []], colWidths: [0.1, 5, 1] }).colWidths).toEqual([0.4, 3, 1])
    expect(reconcileLayout({ cols: [['agenda'], [], []], colWidths: [1, 2] }).colWidths).toBeUndefined() // wrong length
    expect(reconcileLayout({ cols: [['agenda'], [], []], colWidths: [1, -2, 1] }).colWidths).toBeUndefined() // non-positive
    expect(reconcileLayout({ cols: [['agenda'], [], []] }).colWidths).toBeUndefined()
  })

  // --- Hidden cards -------------------------------------------------------

  it('keeps hidden cards out of both the band and the columns', () => {
    const out = reconcileLayout({ full: ['weekCalendar'], cols: [['agenda'], [], []], hidden: ['grocery', 'chores'] })
    expect(out.hidden.sort()).toEqual(['chores', 'grocery'])
    expect(placed(out)).not.toContain('grocery')
    expect(placed(out)).not.toContain('chores')
  })

  it('does not re-append a hidden card as "missing"', () => {
    const out = reconcileLayout({ full: ['weekCalendar'], cols: [['agenda', 'countdowns'], ['tonight', 'week'], ['chores']], hidden: ['grocery'] })
    expect(placed(out)).not.toContain('grocery')
    expect(out.hidden).toEqual(['grocery'])
  })

  it('drops a hidden card even from the band (hidden wins)', () => {
    const out = reconcileLayout({ full: ['weekCalendar'], cols: [[], [], []], hidden: ['weekCalendar'] })
    expect(out.full).not.toContain('weekCalendar')
    expect(out.hidden).toEqual(['weekCalendar'])
  })

  it('does not fall back to default when everything is hidden', () => {
    const out = reconcileLayout({ full: [], cols: [[], [], []], hidden: [...TODAY_CARDS] })
    expect(out.full).toEqual([])
    expect(out.cols).toEqual([[], [], []])
    expect(out.hidden.sort()).toEqual([...TODAY_CARDS].sort())
  })

  it('treats a legacy bare-array layout as {full: [calendar], cols, hidden: []}', () => {
    const out = reconcileLayout(DEFAULT_COLS)
    expect(out.hidden).toEqual([])
    expect(out.cols[0]).toEqual(['agenda', 'countdowns']) // given columns preserved
    expect(placed(out).sort()).toEqual([...TODAY_CARDS].sort()) // module cards + calendar appended
    expect(out.full).toEqual(['weekCalendar'])
  })
})
