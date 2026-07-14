// Walmart cart handoff (fork) — match unchecked grocery items to Walmart
// products and build the add-to-cart deep link. Matching is cache-first
// (walmart_product_matches, 30-day staleness unless user-confirmed), then the
// affiliate search API with the item name normalized into a product query —
// via the household's LLM when one is configured, else a regex heuristic.
import type { QueryResultRow } from 'pg'
import { query } from '../../platform/db'
import { completeJson, getAiConfig } from '../../platform/llm'
import { searchProducts, cartUrl, walmartConfigured, type WalmartProduct } from '../../integrations/walmart'
import { getOrCreateGroceryList, listItems } from '../lists/lists.service'
import type { Tenant } from '../households/households'
import type { WalmartMatch, MatchListResult, MatchCacheRow } from './shopping.types'

const CACHE_FRESH_DAYS = 30
const MIN_CONFIDENCE = 0.34
const MAX_QTY = 12

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

// "×4" / "4" / "2 cans" → a purchase count; weights ("2 lbs") are NOT counts.
export function parseQuantity(quantity: string | null): number {
  if (!quantity) return 1
  const q = quantity.trim().toLowerCase()
  if (/\b(lb|lbs|pound|oz|ounce|g|kg|cup|tsp|tbsp)\b/.test(q)) return 1
  const m = /(?:×|x)?\s*(\d{1,2})\b/.exec(q)
  const n = m ? parseInt(m[1], 10) : 1
  return Math.min(Math.max(n, 1), MAX_QTY)
}

// Regex fallback when no LLM is configured: strip amounts/units/prep notes so
// "2 lbs boneless chicken thighs (trimmed)" → "boneless chicken thighs".
export function heuristicQuery(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^[\s\d/.,½¼¾×x-]+/i, ' ')
    .replace(/^\s*(lb|lbs|pounds?|oz|ounces?|g|kg|cups?|tsp|tbsp|teaspoons?|tablespoons?|cans?|bunch(es)?|bags?|box(es)?|dozen)\b/i, ' ')
    .replace(/^\s*of\b/i, ' ')
    .replace(/\s+/g, ' ')
    .trim() || name.trim()
}

const NORMALIZE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'the grocery item exactly as given' },
          query: { type: 'string', description: 'a short Walmart product search query for it' },
          quantity: { type: 'integer', description: 'how many units to buy (1 unless clearly multiple packages)' },
        },
        required: ['name', 'query', 'quantity'],
      },
    },
  },
  required: ['items'],
} as const

interface NormalizedItem { name: string; query: string; quantity: number }

// One LLM call for the whole list; falls back to the regex heuristic per item
// when no provider is configured or the call fails.
async function normalizeItems(
  householdId: string,
  items: Array<{ name: string; quantity: string | null }>
): Promise<Map<string, NormalizedItem>> {
  const out = new Map<string, NormalizedItem>()
  for (const it of items) {
    out.set(normalizeName(it.name), { name: it.name, query: heuristicQuery(it.name), quantity: parseQuantity(it.quantity) })
  }
  const { provider } = await getAiConfig(householdId)
  if (provider === 'heuristic') return out
  try {
    const { data } = await completeJson(householdId, {
      system:
        'You turn a household grocery list into Walmart product search queries. ' +
        'For each item produce a short search query (brandless unless the item names a brand) ' +
        'and a purchase quantity: the number of packages/units to add to a cart. ' +
        'Weights and volumes ("2 lbs", "500g") are quantity 1 of an appropriately sized product.',
      user: JSON.stringify(items.map((i) => ({ name: i.name, quantity: i.quantity }))),
      schema: NORMALIZE_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'walmart_queries',
      maxTokens: 1200,
    })
    const parsed = (data as { items?: NormalizedItem[] }).items ?? []
    for (const p of parsed) {
      const key = normalizeName(p.name)
      if (!out.has(key) || !p.query) continue
      out.set(key, {
        name: p.name,
        query: p.query.trim(),
        quantity: Math.min(Math.max(Math.round(p.quantity) || 1, 1), MAX_QTY),
      })
    }
  } catch (err) {
    console.error('walmart normalize via LLM failed; using heuristic', err)
  }
  return out
}

// Token-overlap score between the query and a product title, 0..1.
function score(queryText: string, title: string): number {
  const qTokens = new Set(queryText.toLowerCase().split(/\W+/).filter((t) => t.length > 2))
  if (!qTokens.size) return 0
  const tTokens = new Set(title.toLowerCase().split(/\W+/))
  let hit = 0
  for (const t of qTokens) if (tTokens.has(t)) hit++
  return hit / qTokens.size
}

function pickBest(queryText: string, products: WalmartProduct[]): { product: WalmartProduct; confidence: number } | null {
  let best: { product: WalmartProduct; confidence: number } | null = null
  for (const p of products) {
    const s = score(queryText, p.title)
    if (!best || s > best.confidence) best = { product: p, confidence: s }
  }
  return best && best.confidence >= MIN_CONFIDENCE ? best : null
}

interface CacheRowQ extends MatchCacheRow, QueryResultRow {}

async function readCache(householdId: string, keys: string[]): Promise<Map<string, MatchCacheRow>> {
  if (!keys.length) return new Map()
  const { rows } = await query<CacheRowQ>(
    `select item_name_normalized, walmart_item_id, title, price_cents, thumbnail_url, confidence, confirmed, updated_at
       from walmart_product_matches
      where household_id = $1 and item_name_normalized = any($2)
        and (confirmed or updated_at > now() - interval '${CACHE_FRESH_DAYS} days')`,
    [householdId, keys]
  )
  return new Map(rows.map((r) => [r.item_name_normalized, r]))
}

async function writeCache(householdId: string, key: string, product: WalmartProduct, confidence: number): Promise<void> {
  await query(
    `insert into walmart_product_matches
       (household_id, item_name_normalized, walmart_item_id, title, price_cents, thumbnail_url, confidence)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (household_id, item_name_normalized) do update set
       walmart_item_id = excluded.walmart_item_id,
       title = excluded.title,
       price_cents = excluded.price_cents,
       thumbnail_url = excluded.thumbnail_url,
       confidence = excluded.confidence,
       confirmed = false,
       updated_at = now()`,
    [householdId, key, product.itemId, product.title, product.priceCents, product.thumbnailUrl, confidence]
  )
}

/** Match every unchecked grocery item; returns matches + the cart deep link. */
export async function matchGroceryList(tenant: Tenant): Promise<MatchListResult> {
  const list = await getOrCreateGroceryList(tenant)
  const items = (await listItems(tenant.householdId, list.id)).filter((i) => !i.checked)
  if (!items.length) return { matched: [], unmatched: [], cartUrl: null }

  const normalized = await normalizeItems(
    tenant.householdId,
    items.map((i) => ({ name: i.name, quantity: i.quantity }))
  )
  const cache = await readCache(tenant.householdId, [...normalized.keys()])

  const matched: WalmartMatch[] = []
  const unmatched: Array<{ listItemId: string; name: string }> = []

  for (const item of items) {
    const key = normalizeName(item.name)
    const norm = normalized.get(key) ?? { name: item.name, query: heuristicQuery(item.name), quantity: 1 }
    const cached = cache.get(key)
    if (cached) {
      matched.push({
        listItemId: item.id,
        name: item.name,
        quantity: norm.quantity,
        walmartItemId: cached.walmart_item_id,
        title: cached.title ?? '',
        priceCents: cached.price_cents,
        thumbnailUrl: cached.thumbnail_url,
        confidence: cached.confidence,
        confirmed: cached.confirmed,
      })
      continue
    }
    let best: { product: WalmartProduct; confidence: number } | null = null
    try {
      best = pickBest(norm.query, await searchProducts(norm.query))
    } catch (err) {
      console.error('walmart search failed for', norm.query, err)
    }
    if (!best) {
      unmatched.push({ listItemId: item.id, name: item.name })
      continue
    }
    await writeCache(tenant.householdId, key, best.product, best.confidence)
    matched.push({
      listItemId: item.id,
      name: item.name,
      quantity: norm.quantity,
      walmartItemId: best.product.itemId,
      title: best.product.title,
      priceCents: best.product.priceCents,
      thumbnailUrl: best.product.thumbnailUrl,
      confidence: best.confidence,
      confirmed: false,
    })
  }

  return {
    matched,
    unmatched,
    cartUrl: matched.length ? cartUrl(matched.map((m) => ({ walmartItemId: m.walmartItemId, quantity: m.quantity }))) : null,
  }
}

/** Pin a match as user-confirmed (it then never goes stale or gets re-searched). */
export async function confirmMatch(householdId: string, itemName: string, walmartItemId: string): Promise<boolean> {
  const { rowCount } = await query(
    `update walmart_product_matches
        set confirmed = true, walmart_item_id = $3, updated_at = now()
      where household_id = $1 and item_name_normalized = $2`,
    [householdId, normalizeName(itemName), walmartItemId]
  )
  return !!rowCount
}

export function shoppingStatus(): { configured: boolean } {
  return { configured: walmartConfigured() }
}
