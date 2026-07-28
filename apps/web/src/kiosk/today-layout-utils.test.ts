// Characterization tests for the pure Today-board layout helpers (extracted from
// Today.tsx so live-drag and edit-mode share one tested implementation).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  removeCard,
  appendToColumn,
  applyModuleCard,
  hideModuleCard,
  removeCardEverywhere,
  insertAtRegion,
  dropTargetAt,
} from './today-layout-utils'

const layout = (): string[][] => [['agenda', 'countdowns'], ['tonight'], ['chores', 'grocery', 'pantry']]

describe('removeCard', () => {
  it('removes the card from whichever column holds it', () => {
    expect(removeCard(layout(), 'tonight')).toEqual([['agenda', 'countdowns'], [], ['chores', 'grocery', 'pantry']])
  })
  it('is a no-op when the card is not placed', () => {
    expect(removeCard(layout(), 'nope')).toEqual(layout())
  })
})

describe('appendToColumn', () => {
  it('appends to the shortest column when no preference is given', () => {
    expect(appendToColumn(layout(), 'goals')).toEqual([['agenda', 'countdowns'], ['tonight', 'goals'], ['chores', 'grocery', 'pantry']])
  })
  it('appends to the preferred column when given', () => {
    expect(appendToColumn(layout(), 'goals', 2)[2]).toEqual(['chores', 'grocery', 'pantry', 'goals'])
  })
  it('falls back to the first column for an out-of-range preference', () => {
    expect(appendToColumn(layout(), 'goals', 7)[0]).toEqual(['agenda', 'countdowns', 'goals'])
  })
  it('does not mutate the input', () => {
    const input = layout()
    appendToColumn(input, 'goals')
    expect(input).toEqual(layout())
  })
})

describe('applyModuleCard', () => {
  it('injects an enabled, unplaced card into the preferred column', () => {
    expect(applyModuleCard(layout(), 'goals', true, [], 0)[0]).toEqual(['agenda', 'countdowns', 'goals'])
  })
  it('leaves an enabled, already-placed card where the user put it', () => {
    expect(applyModuleCard(layout(), 'pantry', true, [])).toEqual(layout())
  })
  it('strips a disabled card', () => {
    expect(applyModuleCard(layout(), 'pantry', false, [])[2]).toEqual(['chores', 'grocery'])
  })
  it('hidden wins — never injects a hidden card even when its module is on', () => {
    expect(applyModuleCard(layout(), 'goals', true, ['goals'])).toEqual(layout())
  })
  it('hidden wins — strips a placed card the user hid', () => {
    expect(applyModuleCard(layout(), 'pantry', true, ['pantry'])[2]).toEqual(['chores', 'grocery'])
  })
})

describe('hideModuleCard', () => {
  it('strips the card when the module is off', () => {
    expect(hideModuleCard(layout(), 'grocery', false)[2]).toEqual(['chores', 'pantry'])
  })
  it('never injects — leaves the layout alone when the module is on', () => {
    expect(hideModuleCard(layout(), 'goals', true)).toEqual(layout())
  })
})

const regionLayout = () => ({ full: ['weekCalendar'], cols: [['agenda', 'countdowns'], ['tonight'], ['chores', 'grocery', 'pantry']] })

describe('removeCardEverywhere', () => {
  it('drops the card from the band and every column', () => {
    expect(removeCardEverywhere(regionLayout(), 'weekCalendar').full).toEqual([])
    expect(removeCardEverywhere(regionLayout(), 'tonight').cols[1]).toEqual([])
  })
  it('does not mutate the input', () => {
    const input = regionLayout()
    removeCardEverywhere(input, 'agenda')
    expect(input).toEqual(regionLayout())
  })
})

describe('insertAtRegion', () => {
  it('moves a card into a column at the given index (removing it from wherever it was)', () => {
    const out = insertAtRegion(regionLayout(), 'agenda', 1, 1)
    expect(out.cols).toEqual([['countdowns'], ['tonight', 'agenda'], ['chores', 'grocery', 'pantry']])
    expect(out.full).toEqual(['weekCalendar'])
  })
  it('moves a card up into the full-width band', () => {
    const out = insertAtRegion(regionLayout(), 'agenda', 'full', 0)
    expect(out.full).toEqual(['agenda', 'weekCalendar'])
    expect(out.cols[0]).toEqual(['countdowns'])
  })
  it('moves the calendar out of the band down into a column', () => {
    const out = insertAtRegion(regionLayout(), 'weekCalendar', 0, 0)
    expect(out.full).toEqual([])
    expect(out.cols[0]).toEqual(['weekCalendar', 'agenda', 'countdowns'])
  })
  it('falls back to the last column when the target column does not exist', () => {
    expect(insertAtRegion(regionLayout(), 'agenda', 9, 0).cols[2]).toEqual(['agenda', 'chores', 'grocery', 'pantry'])
  })
  it('does not mutate the input', () => {
    const input = regionLayout()
    insertAtRegion(input, 'agenda', 'full', 0)
    expect(input).toEqual(regionLayout())
  })
})

describe('dropTargetAt', () => {
  // jsdom has no layout engine: elementFromPoint doesn't exist (so it's assigned,
  // not spied) and each card's getBoundingClientRect is mocked so midpoint math
  // has real numbers.
  const stubPoint = (el: Element | null) => {
    ;(document as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => el
  }
  afterEach(() => {
    document.body.innerHTML = ''
    delete (document as Partial<Document>).elementFromPoint
    vi.restoreAllMocks()
  })

  // A region container (data-region) holding 3 stacked cards. `region` is the
  // attribute value ('full' for the band, '0'|'1'|… for a column).
  function board(region: string): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute('data-region', region)
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

  it('returns the column region and the index of the card whose midpoint is below the pointer', () => {
    const col = board('1')
    stubPoint(col)
    expect(dropTargetAt(10, 30)).toEqual({ region: 1, index: 0 }) // above card0 midpoint (40)
    expect(dropTargetAt(10, 90)).toEqual({ region: 1, index: 1 }) // past card0, above card1 midpoint (140)
  })

  it('recognizes the full-width band as a region', () => {
    const band = board('full')
    stubPoint(band)
    expect(dropTargetAt(10, 30)).toEqual({ region: 'full', index: 0 })
  })

  it('returns the end of the region when the pointer is below every midpoint', () => {
    const col = board('1')
    stubPoint(col)
    expect(dropTargetAt(10, 500)).toEqual({ region: 1, index: 3 })
  })

  it('resolves the region from a descendant element under the pointer', () => {
    const col = board('2')
    stubPoint(col.children[1] as Element)
    expect(dropTargetAt(10, 90)).toEqual({ region: 2, index: 1 })
  })

  it('returns null off the board', () => {
    board('0')
    stubPoint(document.body)
    expect(dropTargetAt(999, 999)).toBeNull()
    stubPoint(null)
    expect(dropTargetAt(0, 0)).toBeNull()
  })
})
