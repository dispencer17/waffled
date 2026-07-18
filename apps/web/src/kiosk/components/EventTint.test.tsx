import { render, screen } from '@testing-library/react'
import { MonthView } from './MonthView'
import { WeekView } from './WeekView'
import { DayView } from './DayView'
import { ymd, startOfWeek } from './cal-utils'
import type { AgendaEvent } from '../../lib/api'

// Event chips must be tinted through the theme-aware `.ev-tint` CSS hook (an
// `--ev` custom property the stylesheet color-mixes against the current theme's
// ink), NOT a hardcoded `${color}22` wash + raw person color as text — that
// pairing is computed identically in light and dark and goes illegible in dark.

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone
const COLOR = '#2F7FED'

// A timed event this afternoon + an all-day event today, on a stable mid-day
// "now" so day bucketing can't straddle midnight.
const at = (h: number) => {
  const d = new Date()
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}
const makeEvents = () =>
  [
    { id: 'timed', seriesId: null, occurrenceStart: null, title: 'Swim practice', allDay: false, startsAt: at(15), endsAt: at(16), personColor: COLOR, participants: [] },
    { id: 'allday', seriesId: null, occurrenceStart: null, title: 'Spirit week', allDay: true, startsAt: at(0), endsAt: null, personColor: COLOR, participants: [] },
  ] as unknown as AgendaEvent[]

beforeEach(() => {
  const base = new Date()
  base.setHours(12, 0, 0, 0)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(base)
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes('/api/persons')) return { ok: true, json: async () => ({ persons: [] }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
})

afterEach(() => {
  vi.useRealTimers()
})

// The chip carries the person color only as `--ev` for CSS to mix — no literal
// alpha-wash background, no raw text color.
function expectTinted(el: Element | null) {
  expect(el).toBeTruthy()
  const chip = el as HTMLElement
  expect(chip.classList.contains('ev-tint')).toBe(true)
  expect(chip.style.getPropertyValue('--ev')).toBe(COLOR)
  expect(chip.style.backgroundColor).toBe('')
  expect(chip.style.color).toBe('')
}

describe('calendar event chips are theme-aware', () => {
  it('MonthView .ev chips tint via --ev, not a hardcoded wash', async () => {
    const now = new Date()
    render(
      <MonthView
        year={now.getFullYear()}
        month={now.getMonth()}
        events={makeEvents()}
        tz={TZ}
        selectedDay={ymd(now)}
        onSelectDay={() => {}}
        onOpenEvent={() => {}}
        onCreateOnDay={() => {}}
        onMore={() => {}}
      />
    )
    const chips = await screen.findAllByText('Swim practice')
    expectTinted(chips.map((c) => c.closest('.ev')).find(Boolean) ?? null)
  })

  it('WeekView timed + all-day chips tint via --ev', async () => {
    render(
      <WeekView
        weekStart={startOfWeek(new Date())}
        events={makeEvents()}
        tz={TZ}
        onOpenEvent={() => {}}
        onCreate={() => {}}
      />
    )
    expectTinted((await screen.findByText('Swim practice')).closest('.wk-ev'))
    expectTinted((await screen.findByText('Spirit week')).closest('.wk-allday-ev'))
  })

  it('DayView timed + all-day chips tint via --ev', async () => {
    render(
      <DayView
        day={new Date()}
        events={makeEvents()}
        tz={TZ}
        onOpenEvent={() => {}}
        onCreate={() => {}}
      />
    )
    expectTinted((await screen.findByText('Swim practice')).closest('.dv-ev'))
    expectTinted((await screen.findByText('Spirit week')).closest('.dv-allday-ev'))
  })
})
