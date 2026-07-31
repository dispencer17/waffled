import { useEffect, useRef, useState } from 'react'
import { homeAssistantApi, actionFor, isOn, type HaEntity } from '../../lib/api'
import { useCardEmpty } from '../today-card-slot' // fork

// Today card: the admin-pinned Home Assistant entities as one-tap controls.
// Lights/switches toggle, scenes/scripts fire, locks and sensors are read-only.
// State refreshes on an interval plus a quick follow-up after a tap (HA needs a
// beat before the new state is queryable) — with an optimistic flip in between.

const REFRESH_MS = 15_000
const AFTER_TAP_MS = 1_500

function stateLabel(e: HaEntity): string {
  if (e.domain === 'scene' || e.domain === 'script' || e.domain === 'button' || e.domain === 'input_button') return 'Run'
  if (e.state === 'on') return 'On'
  if (e.state === 'off') return 'Off'
  if (e.state === 'unavailable') return '—'
  return e.state
}

function entityEmoji(e: HaEntity): string {
  switch (e.domain) {
    case 'light': return '💡'
    case 'switch': return '🔌'
    case 'fan': return '🌀'
    case 'scene': return '🎬'
    case 'script': return '📜'
    case 'lock': return e.state === 'locked' ? '🔒' : '🔓'
    case 'climate': return '🌡️'
    case 'cover': return '🪟'
    default: return '💠'
  }
}

export function QuickControlsCard() {
  const [entities, setEntities] = useState<HaEntity[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // React 19 requires an explicit initial value for useRef.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let alive = true
    const load = () =>
      homeAssistantApi
        .entities()
        .then((r) => alive && setEntities(r.entities))
        .catch(() => alive && setEntities((prev) => prev ?? []))
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { alive = false; clearInterval(id); clearTimeout(timer.current) }
  }, [])

  const tap = (e: HaEntity) => {
    const action = actionFor(e)
    if (!action || busy) return
    setBusy(e.entityId)
    // Optimistic flip for toggleables so the tap feels instant.
    if (action.service === 'toggle') {
      setEntities((prev) => prev?.map((x) => (x.entityId === e.entityId ? { ...x, state: isOn(x) ? 'off' : 'on' } : x)) ?? prev)
    }
    homeAssistantApi
      .callService(action.domain, action.service, e.entityId)
      .catch(() => {})
      .finally(() => {
        timer.current = setTimeout(() => {
          homeAssistantApi.entities().then((r) => setEntities(r.entities)).catch(() => {})
          setBusy(null)
        }, AFTER_TAP_MS)
      })
  }

  useCardEmpty(entities === null ? undefined : entities.length === 0) // fork — hide-empty board option
  return (
    <div className="card" style={{ padding: '22px 22px 16px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <div className="card-h" style={{ fontSize: 23 }}>Smart Home</div>
      </div>

      {entities === null && <div className="muted" style={{ padding: '10px 4px' }}>Loading…</div>}
      {entities !== null && entities.length === 0 && (
        <div className="muted" style={{ padding: '10px 4px' }}>
          No devices pinned yet — an admin can pick them in Settings → Smart Home.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {(entities ?? []).map((e) => {
          const actionable = !!actionFor(e)
          const on = isOn(e) || e.state === 'locked'
          return (
            <button
              key={e.entityId}
              type="button"
              className={`pill${on ? ' on' : ''}`}
              disabled={!actionable || busy === e.entityId}
              onClick={() => tap(e)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 14px',
                cursor: actionable ? 'pointer' : 'default',
                opacity: e.state === 'unavailable' ? 0.5 : 1,
                textAlign: 'left',
              }}
              aria-label={`${e.name}: ${stateLabel(e)}`}
            >
              <span aria-hidden="true">{entityEmoji(e)}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>{e.name}</span>
              <span className="tiny muted">{busy === e.entityId ? '…' : stateLabel(e)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
