// Characterization tests for the pure Today-board layout helpers (extracted from
// Today.tsx so live-drag and edit-mode share one tested implementation).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  removeCard,
  appendToColumn,
  applyModuleCard,
  hideModuleCard,
  insertAt,
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

describe('insertAt', () => {
  it('moves a card into the target column at the given index', () => {
    expect(insertAt(layout(), 'agenda', 1, 1)).toEqual([['countdowns'], ['tonight', 'agenda'], ['chores', 'grocery', 'pantry']])
  })
  it('inserts at the top and bottom of a column', () => {
    expect(insertAt(layout(), 'grocery', 0, 0)[0]).toEqual(['grocery', 'agenda', 'countdowns'])
    expect(insertAt(layout(), 'grocery', 0, 2)[0]).toEqual(['agenda', 'countdowns', 'grocery'])
  })
  it('falls back to the last column when the target column does not exist', () => {
    expect(insertAt(layout(), 'agenda', 9, 0)[2]).toEqual(['agenda', 'chores', 'grocery', 'pantry'])
  })
  it('does not mutate the input', () => {
    const input = layout()
    insertAt(input, 'agenda', 1, 0)
    expect(input).toEqual(layout())
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

  function board(): HTMLElement {
    const col = document.createElement('div')
    col.setAttribute('data-col', '1')
    const tops = [0, 100, 200]
    for (let i = 0; i < 3; i++) {
      const card = document.createElement('div')
      card.setAttribute('data-card', `card${i}`)
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
        top: tops[i], height: 80, bottom: tops[i] + 80, left: 0, right: 300, width: 300, x: 0, y: tops[i], toJSON: () => ({}),
      } as DOMRect)
      col.appendChild(card)
    }
    document.body.appendChild(col)
    return col
  }

  it('returns the column and the index of the card whose midpoint is below the pointer', () => {
    const col = board()
    stubPoint(col)
    expect(dropTargetAt(10, 30)).toEqual({ col: 1, index: 0 }) // above card0 midpoint (40)
    expect(dropTargetAt(10, 90)).toEqual({ col: 1, index: 1 }) // past card0, above card1 midpoint (140)
  })

  it('returns the end of the column when the pointer is below every midpoint', () => {
    const col = board()
    stubPoint(col)
    expect(dropTargetAt(10, 500)).toEqual({ col: 1, index: 3 })
  })

  it('resolves the column from a descendant element under the pointer', () => {
    const col = board()
    stubPoint(col.children[1] as Element)
    expect(dropTargetAt(10, 90)).toEqual({ col: 1, index: 1 })
  })

  it('returns null off the board', () => {
    board()
    stubPoint(document.body)
    expect(dropTargetAt(999, 999)).toBeNull()
    stubPoint(null)
    expect(dropTargetAt(0, 0)).toBeNull()
  })
})
