import { useNavigate } from 'react-router'
import { useRewardsHub } from '../../lib/api'

// Today-board card for the rewards loop: every member's star balance at a
// glance, a pending-approvals note, and a jump into the Reward Shop
// (/tasks?tab=rewards). Gated on rewardsEnabled(household) in Today.tsx.
export function RewardsCard() {
  const navigate = useNavigate()
  const { balances, pending, loading, error } = useRewardsHub()

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div className="card-h">Rewards</div>
        <button type="button" className="pill" style={{ marginLeft: 'auto' }} onClick={() => navigate('/tasks?tab=rewards')}>
          Shop ›
        </button>
      </div>
      {error && <div className="muted tiny">Couldn't load rewards — try reloading.</div>}
      {loading && balances.length === 0 && !error && <div className="muted tiny">Loading…</div>}
      {!loading && !error && balances.length === 0 && <div className="muted tiny">No star balances yet — award some stars!</div>}
      {balances.map((b) => {
        const color = b.colorHex ?? '#A6A29B'
        return (
          <div key={b.personId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--hair-2)' }}>
            <span className="av sm" style={{ background: `${color}22` }}>{b.avatarEmoji ?? '🙂'}</span>
            <span style={{ flex: 1, fontWeight: 600 }}>{b.name}</span>
            <span style={{ fontWeight: 800 }}>{b.stars}</span>
            <span aria-hidden>⭐</span>
          </div>
        )
      })}
      {pending.length > 0 && (
        <div className="tiny muted" style={{ marginTop: 8, fontWeight: 600 }}>
          {pending.length} waiting for approval
        </div>
      )}
    </div>
  )
}
