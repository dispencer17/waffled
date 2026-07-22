// Week-start-aware date math + compact time labels for the Week calendar card.
import { describe, expect, it } from 'vitest'
import { startOfWeekFor, fmtTimeShort, ymd } from './cal-utils'

describe('startOfWeekFor', () => {
  it('returns the Sunday that starts the week for weekStart=sunday', () => {
    expect(ymd(startOfWeekFor(new Date(2026, 6, 22), 'sunday'))).toBe('2026-07-19') // Wed → prior Sun
    expect(ymd(startOfWeekFor(new Date(2026, 6, 19), 'sunday'))).toBe('2026-07-19') // Sun → itself
  })

  it('returns the Monday that starts the week for weekStart=monday', () => {
    expect(ymd(startOfWeekFor(new Date(2026, 6, 22), 'monday'))).toBe('2026-07-20') // Wed → prior Mon
    expect(ymd(startOfWeekFor(new Date(2026, 6, 20), 'monday'))).toBe('2026-07-20') // Mon → itself
    expect(ymd(startOfWeekFor(new Date(2026, 6, 26), 'monday'))).toBe('2026-07-20') // Sun → the Monday before
  })

  it('defaults to Sunday for a missing/unknown weekStart', () => {
    expect(ymd(startOfWeekFor(new Date(2026, 6, 22)))).toBe('2026-07-19')
    expect(ymd(startOfWeekFor(new Date(2026, 6, 22), 'someday'))).toBe('2026-07-19')
  })
})

describe('fmtTimeShort', () => {
  const at = (iso: string) => ({ allDay: false, startsAt: iso })
  it('renders compact hours', () => {
    expect(fmtTimeShort(at('2026-07-21T13:00:00'))).toBe('1p')
    expect(fmtTimeShort(at('2026-07-21T09:00:00'))).toBe('9a')
    expect(fmtTimeShort(at('2026-07-21T00:00:00'))).toBe('12a')
    expect(fmtTimeShort(at('2026-07-21T12:00:00'))).toBe('12p')
  })
  it('keeps minutes only when present', () => {
    expect(fmtTimeShort(at('2026-07-21T13:30:00'))).toBe('1:30p')
    expect(fmtTimeShort(at('2026-07-21T09:05:00'))).toBe('9:05a')
  })
  it('labels all-day events', () => {
    expect(fmtTimeShort({ allDay: true, startsAt: '2026-07-21T00:00:00' })).toBe('all day')
  })
})
