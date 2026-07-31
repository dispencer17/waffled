import { useEffect, useState } from 'react'
import { EventModal } from './EventModal'
import { eventPeople } from './cal-utils'
import { isPastEvent } from './AgendaView'
import { useEventsToday, usePersons, type AgendaEvent } from '../../lib/api'
import { useEventColor } from '../../lib/event-color'
import { useCardEmpty, useCardOptions } from '../today-card-slot' // fork

function formatTime(e: AgendaEvent): string {
  if (e.allDay) return 'all day'
  const d = new Date(e.startsAt)
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`
}

function AgendaRow({ event, past = false, color: colorProp, onClick }: { event: AgendaEvent; past?: boolean; color?: string; onClick: () => void }) {
  const color = colorProp ?? event.personColor ?? '#A6A29B'
  return (
    <div
      className={`agenda-row${past ? ' past' : ''}`}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '13px 4px',
        borderBottom: '1px solid var(--hair-2)',
        cursor: 'pointer',
      }}
    >
      <div style={{ width: 62, fontSize: 14, fontWeight: 700, color: 'var(--ink-2)', textAlign: 'right' }}>
        {formatTime(event)}
      </div>
      <div style={{ width: 4, height: 34, borderRadius: 99, background: color }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{event.title}</div>
        {event.location && <div className="tiny muted">{event.location}</div>}
      </div>
      <Avatars event={event} />
    </div>
  )
}

// When the day is light (≤3 events), show roomier square-ish cards instead of
// tight rows so the calendar doesn't look sparse.
function AgendaBigCard({ event, past = false, color: colorProp, onClick }: { event: AgendaEvent; past?: boolean; color?: string; onClick: () => void }) {
  const color = colorProp ?? event.personColor ?? '#A6A29B'
  return (
    <div className={`agenda-bigcard${past ? ' past' : ''}`} onClick={onClick} role="button" tabIndex={0} style={{ borderTop: `3px solid ${color}`, '--ev': color } as React.CSSProperties}>
      <div className="ab-time ev-ink">{formatTime(event)}</div>
      <div className="ab-title">{event.title}</div>
      {event.location && <div className="tiny muted ab-loc">📍 {event.location}</div>}
      <div className="ab-foot">
        <Avatars event={event} />
      </div>
    </div>
  )
}

// Participant avatars (stacked); falls back to the single person for older events.
function Avatars({ event }: { event: AgendaEvent }) {
  const people =
    event.participants?.length
      ? event.participants
      : event.personEmoji
        ? [{ id: '_', name: event.personName ?? '', colorHex: event.personColor, avatarEmoji: event.personEmoji }]
        : []
  if (people.length === 0) return null
  return (
    <div style={{ display: 'flex' }}>
      {people.slice(0, 3).map((a, idx) => (
        <div
          key={a.id}
          className="av sm"
          style={{ background: `${a.colorHex ?? '#A6A29B'}22`, marginLeft: idx ? -8 : 0 }}
        >
          {a.avatarEmoji ?? '🙂'}
        </div>
      ))}
    </div>
  )
}

// fork — Per-device people filter, matching the calendar views' chips and the
// week-strip card's persistence (see goalViews/persist.ts for the convention).
const PEOPLE_KEY = 'waffled.agendaPeople'
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

export function AgendaCard() {
  const { events, loading, error, refetch } = useEventsToday()
  const { persons = [] } = usePersons()
  const colorOf = useEventColor('#A6A29B')
  useCardEmpty(loading ? undefined : error ? false : events.length === 0) // fork — hide-empty board option
  const [selected, setSelected] = useState<AgendaEvent | null>(null)
  // fork — same person chips as the calendar Week view: empty selection =
  // everyone; toggling chips narrows to those people. Remembered per device.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(loadPeople()))
  useEffect(() => {
    if (persons.length === 0) return
    setPicked((s) => {
      const known = new Set(persons.map((p) => p.id))
      const pruned = [...s].filter((id) => known.has(id))
      if (pruned.length === s.size) return s
      savePeople(pruned)
      return new Set(pruned)
    })
  }, [persons])
  function togglePerson(id: string) {
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      savePeople([...n])
      return n
    })
  }

  // Fade events that have already ended — mirrors the calendar's agenda list.
  const now = new Date()
  // fork — the hideEnded quiet setting drops ended events entirely.
  const cardOpts = useCardOptions<{ hideEnded?: boolean }>()
  const base =
    picked.size === 0
      ? events
      : events.filter((e) => eventPeople(e).some((p) => picked.has(p.id)) || (e.personId && picked.has(e.personId)))
  const shown = cardOpts?.hideEnded ? base.filter((e) => !isPastEvent(e, now)) : base

  return (
    <div className="card" style={{ padding: '22px 22px 8px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <div className="card-h" style={{ fontSize: 23 }}>
          Today
        </div>
        <div className="muted" style={{ fontWeight: 600 }}>
          {shown.length} {shown.length === 1 ? 'event' : 'events'}
        </div>
        {persons.length > 1 && (
          <div className="wkc-chips" style={{ marginLeft: 'auto' }}>
            {persons.map((p) => {
              const on = picked.has(p.id)
              const color = p.colorHex ?? '#6B6B70'
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`wk-chip ${on ? 'on' : ''}`}
                  style={on ? { background: `${color}22`, borderColor: color, color } : undefined}
                  onClick={() => togglePerson(p.id)}
                >
                  <span className="av sm" style={{ background: `${color}22` }}>{p.avatarEmoji ?? '🙂'}</span>
                  {p.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {loading && <div className="muted" style={{ padding: '14px 4px' }}>Loading…</div>}
      {error && <div className="muted" style={{ padding: '14px 4px' }}>Couldn't load the calendar — try reloading or signing in again.</div>}
      {!loading && !error && shown.length === 0 && (
        <div className="muted" style={{ padding: '14px 4px' }}>
          {picked.size > 0 ? 'Nothing on their calendars today.' : 'Nothing on the calendar today.'}
        </div>
      )}
      {!loading && !error && shown.length > 0 && shown.length <= 3 ? (
        <div className="agenda-biggrid">
          {shown.map((e) => (
            <AgendaBigCard key={e.id} event={e} past={isPastEvent(e, now)} color={colorOf(e)} onClick={() => setSelected(e)} />
          ))}
        </div>
      ) : (
        shown.map((e) => <AgendaRow key={e.id} event={e} past={isPastEvent(e, now)} color={colorOf(e)} onClick={() => setSelected(e)} />)
      )}
      {selected && <EventModal event={selected} onClose={() => setSelected(null)} onSaved={refetch} />}
    </div>
  )
}

