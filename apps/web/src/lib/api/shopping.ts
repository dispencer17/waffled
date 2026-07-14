// Walmart cart handoff (fork) — client slice. The server matches unchecked
// grocery items to Walmart products (LLM query normalization + affiliate
// search, cached per household); the client renders the add-to-cart deep link
// as a QR/tap link. Unmatched items fall back to a text share.
import { apiGet, apiSend } from './client'

export interface WalmartMatch {
  listItemId: string
  name: string
  quantity: number
  walmartItemId: string
  title: string
  priceCents: number | null
  thumbnailUrl: string | null
  confidence: number
  confirmed: boolean
}

export interface WalmartMatchResult {
  matched: WalmartMatch[]
  unmatched: Array<{ listItemId: string; name: string }>
  cartUrl: string | null
}

export const shoppingApi = {
  walmartStatus: () => apiGet<{ configured: boolean }>('/api/shopping/walmart/status'),
  walmartMatch: () => apiSend<WalmartMatchResult>('POST', '/api/shopping/walmart/match', {}),
  walmartConfirm: (itemName: string, walmartItemId: string) =>
    apiSend<{ ok: boolean }>('POST', '/api/shopping/walmart/confirm', { itemName, walmartItemId }),
}
