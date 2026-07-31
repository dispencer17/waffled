// Pure unit tests for the Today-layout normalization (no DB needed).
// v2: layouts are zone trees (FancyZones-style recursive splits); legacy
// {full, cols} and bare-array shapes convert on read.
import { describe, it, expect } from 'vitest'
import {
  reconcileLayout,
  cleanOptions,
  TODAY_CARDS,
  type ZoneNode,
  type ZoneLeaf,
} from '../src/modules/layout/today-layout'

const isLeaf = (n: ZoneNode): n is ZoneLeaf => 'cards' in n

// All leaves pre-order (cards + sizes) — the assertion workhorse.
function leaves(root: ZoneNode): ZoneLeaf[] {
  const out: ZoneLeaf[] = []
  const walk = (n: ZoneNode) => (isLeaf(n) ? out.push(n) : n.children.forEach(walk))
  walk(root)
  return out
}
const allCards = (root: ZoneNode) => leaves(root).flatMap((l) => l.cards)

// The built-in default tree: week-calendar band over three columns.
const DEFAULT_BAND = ['weekCalendar']
const DEFAULT_COLS = [['agenda', 'countdowns'], ['tonight', 'week'], ['chores', 'grocery']]

describe('reconcileLayout (zones v2)', () => {
  it('falls back to the default tree for null / garbage / all-unknown input', () => {
    for (const raw of [null, 'nope', [['unknown'], ['also-bad']]]) {
      const out = reconcileLayout(raw)
      const ls = leaves(out.zones)
      expect(ls[0].cards).toEqual(DEFAULT_BAND)
      expect(ls.slice(1).map((l) => l.cards)).toEqual(DEFAULT_COLS)
      expect(out.hidden).toEqual([])
    }
  })

  it('round-trips a v2 zones layout, preserving structure and card order', () => {
    const zones: ZoneNode = {
      dir: 'row',
      children: [
        { cards: ['agenda', 'grocery'], size: 2 },
        { dir: 'col', children: [{ cards: ['chores'] }, { cards: ['weekCalendar'] }] },
      ],
    }
    const out = reconcileLayout({ zones, hidden: [] })
    expect(leaves(out.zones).map((l) => l.cards)[0]).toEqual(['agenda', 'grocery'])
    // Every known card ends up placed exactly once.
    expect([...allCards(out.zones)].sort()).toEqual([...TODAY_CARDS].sort())
  })

  it('keeps every card exactly once; missing weekCalendar → its own top band zone, other missing → last leaf', () => {
    const out = reconcileLayout({ zones: { dir: 'row', children: [{ cards: ['grocery'] }, { cards: ['agenda'] }] }, hidden: [] })
    const ls = leaves(out.zones)
    expect(ls[0].cards).toEqual(['weekCalendar']) // gets a fresh full-width zone on top
    expect(ls[1].cards[0]).toBe('grocery')
    const last = ls[ls.length - 1]
    expect(last.cards).toContain('tonight') // everything else appends to the LAST leaf
    expect([...allCards(out.zones)].sort()).toEqual([...TODAY_CARDS].sort())
    expect(allCards(out.zones).filter((c) => c === 'agenda')).toHaveLength(1)
  })

  it('dedupes across the whole tree and drops unknown cards', () => {
    const out = reconcileLayout({
      zones: { dir: 'row', children: [{ cards: ['agenda', 'agenda', 'bogus'] }, { cards: ['agenda', 'chores'] }] },
      hidden: [],
    })
    expect(allCards(out.zones).filter((c) => c === 'agenda')).toHaveLength(1)
    expect(allCards(out.zones)).not.toContain('bogus')
  })

  it('clamps zone sizes to [0.25, 4] and defaults omitted sizes on write-through', () => {
    const out = reconcileLayout({
      zones: { dir: 'row', children: [{ cards: ['agenda'], size: 99 }, { cards: ['chores'], size: 0.01 }] },
      hidden: [],
    })
    const ls = leaves(out.zones)
    // ls[0] is the auto-prepended weekCalendar band; the fixture leaves follow.
    expect(ls[1].size).toBe(4)
    expect(ls[2].size).toBe(0.25)
  })

  it('collapses degenerate splits (empty and single-child)', () => {
    const out = reconcileLayout({
      zones: {
        dir: 'col',
        children: [
          { dir: 'row', size: 2, children: [{ cards: ['agenda'] }] }, // single child → collapse, inherit size 2
          { dir: 'row', children: [] }, // empty → removed
          { cards: ['chores'] },
        ],
      },
      hidden: [],
    })
    // Root split has the collapsed leaf directly (index 1 — the auto-prepended
    // weekCalendar band takes index 0).
    if (!isLeaf(out.zones)) {
      expect(isLeaf(out.zones.children[1])).toBe(true)
      expect((out.zones.children[1] as ZoneLeaf).size).toBe(2)
    }
  })

  it('caps runaway trees: leaves beyond 12 merge into the last kept leaf', () => {
    const zones: ZoneNode = { dir: 'row', children: Array.from({ length: 16 }, (_, i) => ({ cards: i === 15 ? ['agenda'] : [] })) }
    const out = reconcileLayout({ zones, hidden: [] })
    expect(leaves(out.zones).length).toBeLessThanOrEqual(12)
    expect(allCards(out.zones)).toContain('agenda') // no card lost to the cap
  })

  it('caps depth by flattening subtrees past depth 4 into a leaf', () => {
    let deep: ZoneNode = { cards: ['agenda'] }
    for (let i = 0; i < 8; i++) deep = { dir: i % 2 ? 'row' : 'col', children: [deep, { cards: [] }] }
    const out = reconcileLayout({ zones: deep, hidden: [] })
    const depthOf = (n: ZoneNode): number => (isLeaf(n) ? 0 : 1 + Math.max(...n.children.map(depthOf)))
    expect(depthOf(out.zones)).toBeLessThanOrEqual(4)
    expect(allCards(out.zones)).toContain('agenda')
  })

  // --- Hidden cards -------------------------------------------------------

  it('keeps hidden cards out of every leaf and does not re-append them', () => {
    const out = reconcileLayout({ zones: { dir: 'row', children: [{ cards: ['agenda', 'grocery'] }, { cards: ['chores'] }] }, hidden: ['grocery', 'countdowns'] })
    expect(out.hidden.sort()).toEqual(['countdowns', 'grocery'])
    expect(allCards(out.zones)).not.toContain('grocery')
    expect(allCards(out.zones)).not.toContain('countdowns')
  })

  it('does not fall back to default when everything is hidden (empty zones are legitimate)', () => {
    const out = reconcileLayout({ zones: { dir: 'row', children: [{ cards: [] }, { cards: [] }] }, hidden: [...TODAY_CARDS] })
    expect(allCards(out.zones)).toEqual([])
    expect(out.hidden.sort()).toEqual([...TODAY_CARDS].sort())
  })

  // --- Legacy conversion --------------------------------------------------

  it('converts a legacy {full, cols, hidden} layout into a band-over-columns tree', () => {
    const out = reconcileLayout({ full: ['weekCalendar'], cols: [['agenda', 'countdowns'], ['tonight', 'week'], ['chores', 'grocery']], hidden: ['rewards', 'pantry', 'familyNight', 'goals', 'smartHome'] })
    const ls = leaves(out.zones)
    expect(ls[0].cards).toEqual(['weekCalendar'])
    expect(ls.slice(1).map((l) => l.cards)).toEqual(DEFAULT_COLS)
  })

  it('maps legacy bandHeight (px) and colWidths (ratios) onto zone sizes', () => {
    const out = reconcileLayout({ full: ['weekCalendar'], cols: [['agenda'], ['tonight'], ['chores']], hidden: [], bandHeight: 640, colWidths: [1.6, 1, 1] })
    const ls = leaves(out.zones)
    expect(ls[0].size).toBeCloseTo(2) // 640 / 320
    expect(ls[1].size).toBeCloseTo(1.6)
    expect(ls[2].size).toBeCloseTo(1)
  })

  it('converts a legacy layout with an empty band without a phantom band leaf', () => {
    const out = reconcileLayout({ full: [], cols: [['weekCalendar', 'agenda'], [], []], hidden: [...TODAY_CARDS.filter((c) => c !== 'weekCalendar' && c !== 'agenda')] })
    const ls = leaves(out.zones)
    expect(ls).toHaveLength(3) // just the three columns
    expect(ls[0].cards).toEqual(['weekCalendar', 'agenda'])
  })

  it('treats a legacy bare-array layout as columns', () => {
    const out = reconcileLayout(DEFAULT_COLS)
    expect(allCards(out.zones).sort()).toEqual([...TODAY_CARDS].sort())
    const ls = leaves(out.zones)
    expect(ls[0].cards).toContain('weekCalendar') // unplaced calendar → first leaf
  })

  // --- Options ------------------------------------------------------------

  it('passes cleaned board options through', () => {
    const out = reconcileLayout({ zones: { dir: 'row', children: [{ cards: ['agenda'] }] }, hidden: [], options: { hideEmpty: true, density: 'compact' } })
    expect(out.options).toEqual({ hideEmpty: true, density: 'compact' })
  })
})

describe('cleanOptions', () => {
  it('keeps only known option keys with valid values', () => {
    expect(cleanOptions({ hideEmpty: true, density: 'compact', bogus: 1 })).toEqual({ hideEmpty: true, density: 'compact' })
    expect(cleanOptions({ density: 'plaid' })).toBeUndefined()
    expect(cleanOptions('nope')).toBeUndefined()
    expect(cleanOptions({})).toBeUndefined()
  })

  it('clamps grocery maxItems to [3, 50] and drops unknown per-card keys', () => {
    expect(cleanOptions({ cards: { grocery: { maxItems: 1 }, bogus: { x: 1 } } })).toEqual({ cards: { grocery: { maxItems: 3 } } })
    expect(cleanOptions({ cards: { grocery: { maxItems: 500 } } })).toEqual({ cards: { grocery: { maxItems: 50 } } })
    expect(cleanOptions({ cards: { agenda: { hideEnded: true }, chores: { hideOpen: false } } })).toEqual({
      cards: { agenda: { hideEnded: true }, chores: { hideOpen: false } },
    })
  })
})

