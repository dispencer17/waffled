import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { shoppingApi, type WalmartMatchResult } from '../../lib/api'
import { formatShareList, type ShareListItem } from './share-list'

// The grocery handoff modals.
//
// ShareListModal — the first-class, no-credentials path: the unchecked items as
// a clean aisle-grouped text list with copy, navigator.share, and a QR code that
// encodes the text itself (a phone camera grabs the list with no account).
//
// WalmartHandoff — the optional extra when Walmart affiliate keys are configured:
// match the unchecked grocery items to Walmart products, then hand the cart off
// to a phone — QR code + tap link open the Walmart app/site with the cart
// pre-filled (checkout happens there, with Walmart+). Unmatched items get a
// copy/share text fallback.

function money(cents: number | null): string {
  return cents == null ? '' : `$${(cents / 100).toFixed(2)}`
}

const canShare = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

export function ShareListModal({ items, onClose }: { items: ShareListItem[]; onClose: () => void }) {
  const text = formatShareList(items)
  const count = items.filter((i) => !i.checked).length
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!text) return
    QRCode.toDataURL(text, { width: 240, margin: 1 })
      .then(setQr)
      .catch(() => setQr(null))
  }, [text])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable (http / permissions) — the QR still works
    }
  }
  async function share() {
    try {
      await navigator.share({ title: 'Grocery list', text })
    } catch {
      // user dismissed the share sheet — nothing to do
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 560, maxHeight: '86vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        <div className="card-h wf-serif" style={{ fontSize: 22, marginBottom: 4 }}>Share list</div>

        {!text ? (
          <div className="muted" style={{ padding: '12px 0' }}>Nothing to share — everything’s checked off. 🎉</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0' }}>
              {qr && <img src={qr} alt="Scan to grab the list" width={160} height={160} style={{ borderRadius: 12 }} />}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>{count} item{count === 1 ? '' : 's'} to get</div>
                <div className="tiny muted" style={{ marginBottom: 10 }}>
                  Scan with a phone camera to grab the list — no app or account needed. Or copy it and text it over.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {canShare() && <button type="button" className="btn btn-primary" onClick={share}>Share…</button>}
                  <button type="button" className={`btn ${canShare() ? 'btn-ghost' : 'btn-primary'}`} onClick={copy}>
                    {copied ? 'Copied ✓' : 'Copy list'}
                  </button>
                </div>
              </div>
            </div>
            <div
              className="share-list-text"
              style={{ whiteSpace: 'pre-wrap', border: '1px solid var(--hair)', borderRadius: 12, padding: '10px 14px', fontWeight: 600, fontSize: 14, lineHeight: 1.6 }}
            >
              {text}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function WalmartHandoff({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<WalmartMatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    shoppingApi
      .walmartMatch()
      .then((r) => alive && setResult(r))
      .catch((e: { status?: number }) =>
        alive && setError(e?.status === 501
          ? 'Walmart isn’t configured on the server yet (WALMART_CONSUMER_ID / WALMART_PRIVATE_KEY).'
          : 'Couldn’t match the list — try again in a minute.')
      )
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!result?.cartUrl) return
    QRCode.toDataURL(result.cartUrl, { width: 240, margin: 1 })
      .then(setQr)
      .catch(() => setQr(null))
  }, [result?.cartUrl])

  const unmatchedText = result?.unmatched.length
    ? `Grocery list:\n${result.unmatched.map((u) => `• ${u.name}`).join('\n')}`
    : ''

  async function copyUnmatched() {
    try {
      if (canShare()) {
        await navigator.share({ text: unmatchedText })
      } else {
        await navigator.clipboard.writeText(unmatchedText)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      // user dismissed the share sheet — nothing to do
    }
  }

  const total = result?.matched.reduce((n, m) => n + (m.priceCents ?? 0) * m.quantity, 0) ?? 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 560, maxHeight: '86vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        <div className="card-h wf-serif" style={{ fontSize: 22, marginBottom: 4 }}>Send to Walmart</div>

        {error && <div className="muted" style={{ padding: '12px 0' }}>{error}</div>}
        {!error && !result && <div className="muted" style={{ padding: '12px 0' }}>Matching your list to Walmart products…</div>}

        {result && (
          <>
            {result.cartUrl ? (
              <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0' }}>
                {qr && <img src={qr} alt="Scan to open the Walmart cart" width={160} height={160} style={{ borderRadius: 12 }} />}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>
                    {result.matched.length} item{result.matched.length === 1 ? '' : 's'} ready
                    {total > 0 && <span className="muted"> · ~{money(total)}</span>}
                  </div>
                  <div className="tiny muted" style={{ marginBottom: 10 }}>
                    Scan with your phone (or tap the link) — the Walmart cart opens pre-filled. Review and check out there with Walmart+.
                  </div>
                  <a className="btn btn-primary" href={result.cartUrl} target="_blank" rel="noreferrer">Open Walmart cart</a>
                </div>
              </div>
            ) : (
              <div className="muted" style={{ padding: '12px 0' }}>Nothing to send — the list has no unchecked items that matched.</div>
            )}

            {result.matched.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
                {result.matched.map((m) => (
                  <div key={m.listItemId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {m.thumbnailUrl
                      ? <img src={m.thumbnailUrl} alt="" width={36} height={36} style={{ borderRadius: 8, objectFit: 'cover' }} />
                      : <span style={{ width: 36, textAlign: 'center' }}>🛒</span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                      <div className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.quantity > 1 ? `${m.quantity} × ` : ''}{m.title} {money(m.priceCents)}
                      </div>
                    </div>
                    {!m.confirmed && m.confidence < 0.67 && (
                      <button
                        type="button"
                        className="pill"
                        style={{ cursor: 'pointer' }}
                        title="Pin this as the right product for next time"
                        onClick={() => shoppingApi.walmartConfirm(m.name, m.walmartItemId).catch(() => {})}
                      >
                        ✓ Right product
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {result.unmatched.length > 0 && (
              <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 10, marginTop: 6 }}>
                <div style={{ fontWeight: 800, marginBottom: 4 }}>Couldn’t match {result.unmatched.length}:</div>
                <div className="tiny muted" style={{ marginBottom: 8 }}>{result.unmatched.map((u) => u.name).join(' · ')}</div>
                <button type="button" className="btn btn-ghost" onClick={copyUnmatched}>
                  {copied ? 'Copied ✓' : canShare() ? 'Share as text' : 'Copy as text'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
