// Walmart affiliate (walmart.io) product search — thin signed-fetch wrapper.
// Auth is Walmart's RSA scheme: each request carries the consumer id, a ms
// timestamp, the key version, and an RSA-SHA256 signature over
// `consumerId\ntimestamp\nkeyVersion\n`. The API base is env-overridable so
// tests can point it at an in-process stub (which skips signature checks).
//
// NOTE: this is the AFFILIATE (Content Provider) API — read-only product data.
// The actual cart handoff is a client-side deep link (affil.walmart.com); no
// purchase API exists for third parties.
import { createSign } from 'node:crypto'
import { config } from '../platform/config'

export interface WalmartProduct {
  itemId: string
  title: string
  priceCents: number | null
  thumbnailUrl: string | null
}

export function walmartConfigured(): boolean {
  const w = config.walmart
  return !!(w.consumerId && w.privateKey)
}

function privateKeyPem(): string {
  // WALMART_PRIVATE_KEY is the base64 of the PEM (newlines don't survive env files).
  const raw = config.walmart.privateKey ?? ''
  return raw.includes('-----BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8')
}

function signedHeaders(): Record<string, string> {
  const w = config.walmart
  const timestamp = Date.now().toString()
  const signer = createSign('RSA-SHA256')
  signer.update(`${w.consumerId}\n${timestamp}\n${w.keyVersion}\n`)
  return {
    'WM_CONSUMER.ID': w.consumerId ?? '',
    'WM_CONSUMER.INTIMESTAMP': timestamp,
    'WM_SEC.KEY_VERSION': w.keyVersion,
    'WM_SEC.AUTH_SIGNATURE': signer.sign(privateKeyPem(), 'base64'),
  }
}

/** Product search. Returns [] on a search miss; throws on transport/auth errors. */
export async function searchProducts(query: string, count = 5): Promise<WalmartProduct[]> {
  const w = config.walmart
  const url = `${w.apiBase}/api-proxy/service/affil/product/v2/search?query=${encodeURIComponent(query)}&numItems=${count}`
  const res = await fetch(url, { headers: signedHeaders(), signal: AbortSignal.timeout(10_000) })
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`walmart search -> ${res.status} ${await res.text().catch(() => '')}`)
  const data = (await res.json()) as { items?: Array<Record<string, unknown>> }
  return (data.items ?? []).map((i) => ({
    itemId: String(i.itemId),
    title: String(i.name ?? ''),
    priceCents: typeof i.salePrice === 'number' ? Math.round(i.salePrice * 100) : null,
    thumbnailUrl: (i.thumbnailImage as string | undefined) ?? null,
  }))
}

/** The add-to-cart deep link: scan/tap → Walmart app cart with these items. */
export function cartUrl(items: Array<{ walmartItemId: string; quantity: number }>): string {
  const parts = items.map((i) => (i.quantity > 1 ? `${i.walmartItemId}_${i.quantity}` : i.walmartItemId))
  const w = config.walmart
  const affil = `https://affil.walmart.com/cart/addToCart?items=${parts.join(',')}`
  return w.publisherId ? `${affil}&publisherId=${encodeURIComponent(w.publisherId)}` : affil
}
