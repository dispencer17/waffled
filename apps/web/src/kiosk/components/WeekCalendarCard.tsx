import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useEventsRange, useHousehold, type AgendaEvent } from '../../lib/api'
import { useEventColor } from '../../lib/event-color'
import { weekCardStyle } from '../../lib/display'
import { DOW, ymd, addDays, localDate, startOfWeekFor, fmtTimeShort, eventDetailPath } from './cal-utils'

// FamilyBoard-style week strip for the Today board: 7 day columns (honoring the
// household's week-start day), today's header ringed, and events stacked
// top-to-bottom as solid person-color blocks — no hour grid, maximum color.
// Blocks are ALWAYS solid regardless of the household event-style setting;
// at this size a tint wash is illegible, and the solid look is the point.
// The household `weekCard` display setting picks the day treatment: 'separated'
// (distinct bordered day cells, the default FamilyBoard look) or 'plain'.
export function WeekCalendarCard() {
  const { household } = useHousehold()
  const colorOf = useEventColor()
  const separated = weekCardStyle(household) === 'separated'
  const navigate = useNavigate()
  const ws = useMemo(() => startOfWeekFor(new Date(), household?.weekStart), [household?.weekStart])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(ws, i)), [ws])
  const { events, loading, error } = useEventsRange(ymd(ws), ymd(addDays(ws, 6)))
  const tz = household?.timezone ?? 'UTC'
  const today = ymd(new Date())

  // Bucket by household-tz day; all-day events pin to the top, the rest sort by time.
  const byDay = useMemo(() => {
    const map: Record<string, AgendaEvent[]> = {}
    for (const e of events) (map[localDate(e.startsAt, tz)] ??= []).push(e)
    for (const list of Object.values(map)) {
      list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt))
    }
    return map
  }, [events, tz])

  return (
    <div className="card wkc-card">
      <div className="wkc-head-row">
        <div className="card-h">This week</div>
        <button type="button" className="pill" onClick={() => navigate('/calendar')}>
          Calendar ›
        </button>
      </div>
      {error && <div className="muted tiny wkc-note">Couldn't load the calendar — try reloading.</div>}
      {loading && events.length === 0 && !error && <div className="muted tiny wkc-note">Loading…</div>}
      <div className={`wkc-grid ${separated ? 'wkc-separated' : ''}`}>
        {days.map((d) => {
          const key = ymd(d)
          const list = byDay[key] ?? []
          return (
            <div className={`wkc-col ${key === today ? 'wkc-col-today' : ''}`} data-date={key} key={key}>
              <button type="button" className={`wkc-day-h ${key === today ? 'today' : ''}`} onClick={() => navigate('/calendar')}>
                <div className="wkc-dow">{DOW[d.getDay()]}</div>
                <div className="wkc-dn">{d.getDate()}</div>
              </button>
              <div className="wkc-evs">
                {list.map((e) => (
                  <div
                    key={e.id + (e.occurrenceStart ?? '')}
                    className={`wkc-ev ${e.allDay ? 'allday' : ''}`}
                    style={{ '--ev': colorOf(e) } as React.CSSProperties}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(eventDetailPath(e))}
                    onKeyDown={(ev) => ev.key === 'Enter' && navigate(eventDetailPath(e))}
                  >
                    <div className="wkc-ev-t">{fmtTimeShort(e)}</div>
                    <div className="wkc-ev-title">
                      {e.occurrenceStart && <span className="ev-rep">↻ </span>}
                      {e.title}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
