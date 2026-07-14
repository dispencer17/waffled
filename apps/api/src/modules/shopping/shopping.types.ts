// Walmart cart handoff (fork) — shared shapes.

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

export interface MatchListResult {
  matched: WalmartMatch[]
  unmatched: Array<{ listItemId: string; name: string }>
  cartUrl: string | null
}

export interface MatchCacheRow {
  item_name_normalized: string
  walmart_item_id: string
  title: string | null
  price_cents: number | null
  thumbnail_url: string | null
  confidence: number
  confirmed: boolean
  updated_at: Date
}
