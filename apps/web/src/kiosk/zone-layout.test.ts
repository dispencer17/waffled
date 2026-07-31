// Tests for the zone-tree layout helpers — the FancyZones-style generalization
// of the old band+columns model. A layout is a recursive split-tree; leaves hold
// ordered card stacks; zone identity is the pre-order child-index path ('1.0').
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type ZoneNode,
  isLeaf,
  getNode,
  listLeaves,
  splitZone,
  deleteZone,
  resizeSiblings,
  setZoneSize,
  removeCardEverywhere,
  insertAtZone,
  appendCard,
  applyModuleCard,
  hideModuleCard,
  dropTargetAt,
  SIZE_MIN,
  SIZE_MAX,
} from './zone-layout'

// The default board as a tree: week-calendar band over three columns.
const tree = (): ZoneNode => ({
  dir: 'col',
  children: [
    { cards: ['weekCalendar'], size: 1 },
    {
      dir: 'row',
      size: 1.6,
      children: [{ cards: ['agenda', 'countdowns'] }, { cards: ['tonight'] }, { cards: ['chores', 'grocery', 'pantry'] }],
    },
  ],
})

describe('getNode / listLeaves / isLeaf', () => {
  it('resolves nodes by child-index path', () => {
    expect(getNode(tree(), '')).toEqual(tree())
    expect(getNode(tree(), '0')).toEqual({ cards: ['weekCalendar'], size: 1 })
    expect(getNode(tree(), '1.1')).toEqual({ cards: ['tonight'] })
    expect(getNode(tree(), '9')).toBeNull()
    expect(getNode(tree(), '1.1.0')).toBeNull()
  })

  it('lists leaves pre-order with their paths', () => {
    expect(listLeaves(tree()).map((l) => l.path)).toEqual(['0', '1.0', '1.1', '1.2'])
    expect(listLeaves(tree())[1].leaf.cards).toEqual(['agenda', 'countdowns'])
  })

  it('discriminates leaves from splits', () => {
    expect(isLeaf({ cards: [] })).toBe(true)
    expect(isLeaf({ dir: 'row', children: [{ cards: [] }] })).toBe(false)
  })
})

describe('splitZone', () => {
  it('inserts an empty sibling when the parent already splits in that direction', () => {
    const out = splitZone(tree(), '1.1', 'row')
    const row = getNode(out, '1')
    expect(isLeaf(row!)).toBe(false)
    if (row && !isLeaf(row)) {
      expect(row.children).toHaveLength(4)
      expect(row.children[2]).toEqual({ cards: [], size: 0.5 }) // new empty leaf after the target
      expect(row.children[1]).toMatchObject({ cards: ['tonight'], size: 0.5 }) // target halved
    }
  })

  it('wraps the leaf in a new 2-child split when the direction differs', () => {
    const out = splitZone(tree(), '1.1', 'col')
    const wrapped = getNode(out, '1.1')
    expect(wrapped).toEqual({ dir: 'col', size: 1, children: [{ cards: ['tonight'], size: 1 }, { cards: [], size: 1 }] })
  })

  it('does not mutate the input', () => {
    const input = tree()
    splitZone(input, '1.1', 'row')
    expect(input).toEqual(tree())
  })
})

describe('deleteZone', () => {
  it("merges the leaf's cards into its previous sibling's first leaf and removes it", () => {
    const out = deleteZone(tree(), '1.1')
    const row = getNode(out, '1')
    if (row && !isLeaf(row)) {
      expect(row.children).toHaveLength(2)
      expect(row.children[0]).toMatchObject({ cards: ['agenda', 'countdowns', 'tonight'] })
    }
  })

  it('merges into the next sibling when deleting the first child (deleted cards keep their board position, so they prepend)', () => {
    const out = deleteZone(tree(), '1.0')
    const row = getNode(out, '1')
    if (row && !isLeaf(row)) {
      expect(row.children[0]).toMatchObject({ cards: ['agenda', 'countdowns', 'tonight'] })
    }
  })

  it('collapses a single-child split into the child, which inherits the outer size', () => {
    // Delete both column leaves 1.1 and 1.2 → the row split has one child left and collapses.
    const out = deleteZone(deleteZone(tree(), '1.1'), '1.1')
    const collapsed = getNode(out, '1')
    expect(collapsed).toMatchObject({ cards: ['agenda', 'countdowns', 'tonight', 'chores', 'grocery', 'pantry'], size: 1.6 })
  })

  it('refuses to delete the last remaining leaf', () => {
    const solo: ZoneNode = { dir: 'col', children: [{ cards: ['agenda'] }] }
    expect(deleteZone(solo, '0')).toEqual(solo)
  })

  it('does not mutate the input', () => {
    const input = tree()
    deleteZone(input, '1.1')
    expect(input).toEqual(tree())
  })
})

describe('resizeSiblings', () => {
  it('shifts the ratio between a sibling pair, clamped on both ends', () => {
    const out = resizeSiblings(tree(), '1', 0, 0.5)
    const row = getNode(out, '1')
    if (row && !isLeaf(row)) {
      expect(row.children[0].size).toBeCloseTo(1.5)
      expect(row.children[1].size).toBeCloseTo(0.5) // 1 - 0.5, still above SIZE_MIN
    }
  })

  it('clamps to SIZE_MIN / SIZE_MAX independently', () => {
    const out = resizeSiblings(tree(), '1', 0, 99)
    const row = getNode(out, '1')
    if (row && !isLeaf(row)) {
      expect(row.children[0].size).toBe(SIZE_MAX)
      expect(row.children[1].size).toBe(SIZE_MIN)
    }
  })

  it('is a no-op for a non-split path or out-of-range index', () => {
    expect(resizeSiblings(tree(), '0', 0, 1)).toEqual(tree())
    expect(resizeSiblings(tree(), '1', 2, 1)).toEqual(tree()) // no right-hand sibling
  })
})

describe('setZoneSize', () => {
  it('sets a clamped size on the node at the path without mutating', () => {
    const input = tree()
    const out = setZoneSize(input, '0', 2.5)
    expect((getNode(out, '0') as { size?: number }).size).toBe(2.5)
    expect(setZoneSize(tree(), '0', 99)).toEqual(setZoneSize(tree(), '0', SIZE_MAX))
    expect(input).toEqual(tree())
  })
  it('is a no-op for an unknown path', () => {
    expect(setZoneSize(tree(), '9.9', 2)).toEqual(tree())
  })
})

describe('removeCardEverywhere / insertAtZone / appendCard', () => {
  it('removes a card from any leaf in the tree', () => {
    const out = removeCardEverywhere(tree(), 'grocery')
    expect(getNode(out, '1.2')).toMatchObject({ cards: ['chores', 'pantry'] })
  })

  it('moves a card between leaves (removing it from wherever it was)', () => {
    const out = insertAtZone(tree(), 'agenda', '1.1', 1)
    expect(getNode(out, '1.0')).toMatchObject({ cards: ['countdowns'] })
    expect(getNode(out, '1.1')).toMatchObject({ cards: ['tonight', 'agenda'] })
  })

  it('moves a card into the band leaf', () => {
    const out = insertAtZone(tree(), 'agenda', '0', 0)
    expect(getNode(out, '0')).toMatchObject({ cards: ['agenda', 'weekCalendar'] })
  })

  it('falls back to the last leaf for an unknown path', () => {
    const out = insertAtZone(tree(), 'agenda', '9.9', 0)
    expect(getNode(out, '1.2')).toMatchObject({ cards: ['agenda', 'chores', 'grocery', 'pantry'] })
  })

  it('appendCard picks the leaf with the fewest cards (first pre-order on ties)', () => {
    const out = appendCard(tree(), 'goals')
    expect(getNode(out, '0')).toMatchObject({ cards: ['weekCalendar', 'goals'] })
  })

  it('appendCard honors a valid preferred path', () => {
    const out = appendCard(tree(), 'goals', '1.2')
    expect(getNode(out, '1.2')).toMatchObject({ cards: ['chores', 'grocery', 'pantry', 'goals'] })
  })

  it('does not mutate the input', () => {
    const input = tree()
    insertAtZone(input, 'agenda', '1.1', 0)
    appendCard(input, 'goals')
    removeCardEverywhere(input, 'grocery')
    expect(input).toEqual(tree())
  })
})

describe('applyModuleCard / hideModuleCard (zone-tree semantics match the old board)', () => {
  it('injects an enabled, unplaced card into the preferred leaf', () => {
    const out = applyModuleCard(tree(), 'goals', true, [], '1.0')
    expect(getNode(out, '1.0')).toMatchObject({ cards: ['agenda', 'countdowns', 'goals'] })
  })
  it('leaves an enabled, already-placed card where the user put it', () => {
    expect(applyModuleCard(tree(), 'pantry', true, [])).toEqual(tree())
  })
  it('strips a disabled card', () => {
    expect(getNode(applyModuleCard(tree(), 'pantry', false, []), '1.2')).toMatchObject({ cards: ['chores', 'grocery'] })
  })
  it('hidden wins — never injects a hidden card', () => {
    expect(applyModuleCard(tree(), 'goals', true, ['goals'])).toEqual(tree())
  })
  it('hidden wins — strips a placed card the user hid', () => {
    expect(getNode(applyModuleCard(tree(), 'pantry', true, ['pantry']), '1.2')).toMatchObject({ cards: ['chores', 'grocery'] })
  })
  it('hideModuleCard strips when off, never injects when on', () => {
    expect(getNode(hideModuleCard(tree(), 'grocery', false), '1.2')).toMatchObject({ cards: ['chores', 'pantry'] })
    expect(hideModuleCard(tree(), 'goals', true)).toEqual(tree())
  })
})

describe('dropTargetAt (zone paths)', () => {
  // jsdom has no layout engine: elementFromPoint doesn't exist (assigned, not
  // spied) and each card's getBoundingClientRect is mocked for real midpoints.
  const stubPoint = (el: Element | null) => {
    ;(document as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => el
  }
  afterEach(() => {
    document.body.innerHTML = ''
    delete (document as Partial<Document>).elementFromPoint
    vi.restoreAllMocks()
  })

  function zone(path: string): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute('data-region', path)
    const tops = [0, 100, 200]
    for (let i = 0; i < 3; i++) {
      const card = document.createElement('div')
      card.setAttribute('data-card', `card${i}`)
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
        top: tops[i], height: 80, bottom: tops[i] + 80, left: 0, right: 300, width: 300, x: 0, y: tops[i], toJSON: () => ({}),
      } as DOMRect)
      el.appendChild(card)
    }
    document.body.appendChild(el)
    return el
  }

  it('returns the zone path and the index of the card whose midpoint is below the pointer', () => {
    const el = zone('1.0')
    stubPoint(el)
    expect(dropTargetAt(10, 30)).toEqual({ path: '1.0', index: 0 })
    expect(dropTargetAt(10, 90)).toEqual({ path: '1.0', index: 1 })
  })

  it('returns the end of the zone below every midpoint, resolving from descendants', () => {
    const el = zone('0')
    stubPoint(el.children[2] as Element)
    expect(dropTargetAt(10, 500)).toEqual({ path: '0', index: 3 })
  })

  it('returns null off the board', () => {
    zone('0')
    stubPoint(document.body)
    expect(dropTargetAt(999, 999)).toBeNull()
    stubPoint(null)
    expect(dropTargetAt(0, 0)).toBeNull()
  })
})
