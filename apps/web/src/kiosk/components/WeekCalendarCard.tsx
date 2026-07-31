import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useEventsRange, useHousehold, usePersons, type AgendaEvent } from '../../lib/api'
import { useEventColor } from '../../lib/event-color'
import { useCardEmpty } from '../today-card-slot' // fork
import { weekCardStyle } from '../../lib/display'
import { DOW, ymd, addDays, localDate, startOfWeekFor, fmtTimeShort, durationMin, eventPeople, eventDetailPath } from './cal-utils'

// fork — Per-device people filter for the card, matching this app's convention
// of direct, try/catch-wrapped localStorage colocated with the feature (see
// goalViews/persist.ts). A wall kiosk keeps its filter across reloads.
const PEOPLE_KEY = 'waffled.wkcPeople'
function loadPeople(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PEOPLE_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function savePeople(ids: string[]): void {
  try {
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(ids))
  } catch {
    /* private mode */
  }
}

// FamilyBoard-style week strip for the Today board: 7 day columns (honoring the
// household's week-start day), today's header ringed, and events stacked
// top-to-bottom as solid person-color blocks — no hour grid, maximum color.
// Blocks are ALWAYS solid regardless of the household event-style setting;
// at this size a tint wash is illegible, and the solid look is the point.
// The household `weekCard` display setting picks the day treatment: 'separated'
// (distinct bordered day cells, the default FamilyBoard look) or 'plain'.
// Person chips filter the week (same semantics as the calendar Week view),
// remembered per device; events happening right now get a live pulse.
export function WeekCalendarCard() {
  const { household } = useHousehold()
  const { persons = [] } = usePersons()
  const colorOf = useEventColor()
  const separated = weekCardStyle(household) === 'separated'
  const navigate = useNavigate()
  const ws = useMemo(() => startOfWeekFor(new Date(), household?.weekStart), [household?.weekStart])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(ws, i)), [ws])
  const { events, loading, error } = useEventsRange(ymd(ws), ymd(addDays(ws, 6)))
  const tz = household?.timezone ?? 'UTC'
  const today = ymd(new Date())
  useCardEmpty(loading && events.length === 0 ? undefined : error ? false : events.length === 0) // fork — hide-empty board option

  // Empty selection = everyone (no filter); toggling a chip narrows to those people.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(loadPeople()))
  // Prune stored ids to known members once they load, so a removed family
  // member can't invisibly filter the whole week out forever.
  useEffect(() => {
    if (persons.length === 0) return
    setSelected((s) => {
      const known = new Set(persons.map((p) => p.id))
      const pruned = [...s].filter((id) => known.has(id))
      if (pruned.length === s.size) return s
      savePeople(pruned)
      return new Set(pruned)
    })
  }, [persons])
  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      savePeople([...n])
      return n
    })
  }
  // Same semantics as WeekView: participants OR the color owner (the synthetic
  // '_' id from eventPeople is why the personId check must stay).
  const visible = useMemo(() => {
    if (selected.size === 0) return events
    return events.filter((e) => eventPeople(e).some((p) => selected.has(p.id)) || (e.personId && selected.has(e.personId)))
  }, [events, selected])

  // Minute tick so the in-progress pulse follows the clock.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const isNow = (e: AgendaEvent): boolean => {
    if (e.allDay) return false
    const s = new Date(e.startsAt).getTime()
    return s <= now && now < s + durationMin(e) * 60_000
  }

  // Bucket by household-tz day; all-day events pin to the top, the rest sort by time.
  const byDay = useMemo(() => {
    const map: Record<string, AgendaEvent[]> = {}
    for (const e of visible) (map[localDate(e.startsAt, tz)] ??= []).push(e)
    for (const list of Object.values(map)) {
      list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt))
    }
    return map
  }, [visible, tz])

  return (
    <div className="card wkc-card">
      <div className="wkc-head-row">
        <div className="card-h">This week</div>
        <button type="button" className="pill" onClick={() => navigate('/calendar')}>
          Calendar ›
        </button>
      </div>
      {persons.length > 1 && (
        <div className="wkc-chips">
          {persons.map((p) => {
            const on = selected.has(p.id)
            const color = p.colorHex ?? '#6B6B70'
            return (
              <button
                key={p.id}
                type="button"
                className={`wk-chip ${on ? 'on' : ''}`}
                style={on ? { background: `${color}22`, borderColor: color, color } : undefined}
                onClick={() => toggle(p.id)}
              >
                <span className="av sm" style={{ background: `${color}22` }}>{p.avatarEmoji ?? '🙂'}</span>
                {p.name}
              </button>
            )
          })}
        </div>
      )}
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
                {list.map((e) => {
                  const live = isNow(e)
                  return (
                    <div
                      key={e.id + (e.occurrenceStart ?? '')}
                      className={`wkc-ev ${e.allDay ? 'allday' : ''} ${live ? 'wkc-ev--now' : ''}`}
                      style={{ '--ev': colorOf(e) } as React.CSSProperties}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(eventDetailPath(e))}
                      onKeyDown={(ev) => ev.key === 'Enter' && navigate(eventDetailPath(e))}
                    >
                      <div className="wkc-ev-t">
                        {live && <span className="wkc-ev-live" aria-hidden>● </span>}
                        {fmtTimeShort(e)}
                      </div>
                      <div className="wkc-ev-title">
                        {e.occurrenceStart && <span className="ev-rep">↻ </span>}
                        {e.title}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
