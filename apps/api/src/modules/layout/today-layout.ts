// Today dashboard layout — a family default (households.today_layout) plus an
// optional per-person override (persons.today_layout). The resolved layout the
// kiosk renders is user ?? family ?? the built-in default, always reconciled
// against the canonical card set so newly added cards appear and removed/unknown
// keys are dropped (a card is never lost or duplicated).
//
// v2 (fork): layouts are FancyZones-style zone trees — recursive row/col splits
// whose leaves hold ordered card stacks, sized by flex ratios. Legacy
// {full, cols, bandHeight, colWidths} and bare-array rows convert on read and
// are rewritten as zones on the user's next save. Keep the tree shape + clamps
// in sync with the kiosk's apps/web/src/kiosk/zone-layout.ts.
import createAPI, { type Request, type Response } from 'lambda-api'
import { query } from '../../platform/db'
import { requireAdmin } from '../households/households'
import { tenantRoute } from '../../platform/route-guards'

type Api = ReturnType<typeof createAPI>

// The cards that can appear on Today. Order here is the default reading order.
// Module cards (pantry, familyNight, goals, smartHome) are injected on the client when
// their module is on; they must be accepted here too or saving a layout that includes
// one 400s. Keep this in sync with the kiosk's CARDS map (apps/web Today.tsx).
export const TODAY_CARDS = ['agenda', 'countdowns', 'tonight', 'week', 'chores', 'rewards', 'grocery', 'pantry', 'familyNight', 'goals', 'smartHome', 'weekCalendar'] as const
const CARD_SET = new Set<string>(TODAY_CARDS)
// The designed full-width card: when unplaced it appends to the FIRST leaf (the
// top band in the default tree), everything else to the last.
const FULL_DEFAULT_CARD = 'weekCalendar'

// --- Zone tree model (mirrored in apps/web/src/kiosk/zone-layout.ts) ---------

export type ZoneLeaf = { cards: string[]; size?: number }
export type ZoneSplit = { dir: 'row' | 'col'; size?: number; children: ZoneNode[] }
export type ZoneNode = ZoneLeaf | ZoneSplit

// Flex-ratio clamps and structure caps — a bad blob must still render sanely.
const SIZE_MIN = 0.25
const SIZE_MAX = 4
const MAX_LEAVES = 12
const MAX_DEPTH = 4
// Legacy bandHeight was pixels against a ~320px default; ratios divide it out.
const LEGACY_BAND_PX = 320

const isLeaf = (n: ZoneNode): n is ZoneLeaf => 'cards' in n
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const cleanSize = (raw: unknown): number | undefined =>
  typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, SIZE_MIN, SIZE_MAX) : undefined

// The built-in default arrangement: the week calendar spans a full-width band
// on top, the rest fill 3 columns below (mirrors the FamilyBoard layout).
function defaultZones(): ZoneNode {
  // In a col split, an explicit size means a pinned height (ratio × the legacy
  // 320px band unit) — the content row below stays auto-sized, so it has none.
  return {
    dir: 'col',
    children: [
      { cards: [FULL_DEFAULT_CARD], size: 1 },
      {
        dir: 'row',
        children: [{ cards: ['agenda', 'countdowns'] }, { cards: ['tonight', 'week'] }, { cards: ['chores', 'grocery'] }],
      },
    ],
  }
}

// --- Board options (signal-to-noise settings, stored alongside the layout) ---

export interface BoardOptions {
  hideEmpty?: boolean
  density?: 'cozy' | 'compact'
  cards?: {
    agenda?: { hideEnded?: boolean }
    grocery?: { maxItems?: number }
    chores?: { hideOpen?: boolean }
  }
}

const GROCERY_MAX_MIN = 3
const GROCERY_MAX_MAX = 50

/** Deep-clean arbitrary json into BoardOptions; undefined when nothing valid survives. */
export function cleanOptions(raw: unknown): BoardOptions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: BoardOptions = {}
  if (typeof o.hideEmpty === 'boolean') out.hideEmpty = o.hideEmpty
  if (o.density === 'cozy' || o.density === 'compact') out.density = o.density
  if (o.cards && typeof o.cards === 'object' && !Array.isArray(o.cards)) {
    const c = o.cards as Record<string, unknown>
    const cards: NonNullable<BoardOptions['cards']> = {}
    const agenda = c.agenda as Record<string, unknown> | undefined
    if (agenda && typeof agenda.hideEnded === 'boolean') cards.agenda = { hideEnded: agenda.hideEnded }
    const grocery = c.grocery as Record<string, unknown> | undefined
    if (grocery && typeof grocery.maxItems === 'number' && Number.isFinite(grocery.maxItems)) {
      cards.grocery = { maxItems: Math.round(clamp(grocery.maxItems, GROCERY_MAX_MIN, GROCERY_MAX_MAX)) }
    }
    const chores = c.chores as Record<string, unknown> | undefined
    if (chores && typeof chores.hideOpen === 'boolean') cards.chores = { hideOpen: chores.hideOpen }
    if (Object.keys(cards).length > 0) out.cards = cards
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// A normalized layout: the zone tree, the cards the user explicitly hid, and
// the board's noise options. Hidden cards are kept out of every leaf AND the
// missing-append pass, so a card the user removed stays removed.
export interface StoredLayout {
  zones: ZoneNode
  hidden: string[]
  options?: BoardOptions
}

// Pull a clean, deduped list of known card keys out of arbitrary json.
function cleanKeys(raw: unknown): { keys: string[]; seen: Set<string> } {
  const keys: string[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw)) {
    for (const k of raw) {
      if (typeof k === 'string' && CARD_SET.has(k) && !seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  return { keys, seen }
}

// Flatten any split sitting at or past `maxDepth` into a single leaf (cards
// gathered pre-order) — used before a wrap that would add a level.
function flattenPastDepth(node: ZoneNode, maxDepth: number, depth = 0): ZoneNode {
  if (isLeaf(node)) return node
  if (depth >= maxDepth) {
    const cards: string[] = []
    const gather = (m: ZoneNode) => (isLeaf(m) ? cards.push(...m.cards) : m.children.forEach(gather))
    gather(node)
    return { cards, ...(node.size != null ? { size: node.size } : {}) }
  }
  return { ...node, children: node.children.map((c) => flattenPastDepth(c, maxDepth, depth + 1)) }
}

// Legacy {full, cols, bandHeight, colWidths} / bare string[][] → a zone tree
// (band leaf over a row of column leaves; no band leaf when the band is empty).
function legacyToZones(raw: unknown): ZoneNode {
  const isTagged = !!raw && typeof raw === 'object' && !Array.isArray(raw)
  const o = (isTagged ? raw : {}) as { full?: unknown; cols?: unknown; bandHeight?: unknown; colWidths?: unknown }
  const rawFull = Array.isArray(o.full) ? (o.full as unknown[]) : []
  const rawCols = Array.isArray(o.cols) ? (o.cols as unknown[]) : Array.isArray(raw) ? (raw as unknown[]) : []
  const widths = Array.isArray(o.colWidths) ? (o.colWidths as unknown[]) : []
  const colLeaves: ZoneNode[] = rawCols.map((col, i) => ({
    cards: Array.isArray(col) ? col.filter((c): c is string => typeof c === 'string') : [],
    ...(cleanSize(widths[i]) != null ? { size: cleanSize(widths[i]) } : {}),
  }))
  const row: ZoneSplit = { dir: 'row', children: colLeaves.length ? colLeaves : [{ cards: [] }] }
  if (rawFull.length === 0) return row
  const bandSize =
    typeof o.bandHeight === 'number' && Number.isFinite(o.bandHeight)
      ? clamp(o.bandHeight / LEGACY_BAND_PX, SIZE_MIN, SIZE_MAX)
      : 1
  return {
    dir: 'col',
    children: [{ cards: rawFull.filter((c): c is string => typeof c === 'string'), size: bandSize }, row],
  }
}

// Coerce arbitrary stored/posted json into a clean StoredLayout: sanitize the
// tree (drop unknown/duplicate/hidden cards, clamp sizes, collapse degenerate
// splits, cap size/depth), then append any missing (not-placed, not-hidden)
// card — the week calendar to the first leaf, everything else to the last —
// so nothing is lost as the card set grows. Accepts the v2 {zones, hidden,
// options} shape, the legacy {full, cols, hidden, sizes} shape, and a legacy
// bare `string[][]`.
export function reconcileLayout(raw: unknown): StoredLayout {
  const isObj = !!raw && typeof raw === 'object' && !Array.isArray(raw)
  const o = (isObj ? raw : {}) as { zones?: unknown; hidden?: unknown; options?: unknown }
  const { keys: hidden, seen: hiddenSet } = cleanKeys(o.hidden)
  const options = cleanOptions(o.options)

  const source: ZoneNode | null =
    isObj && o.zones != null
      ? (o.zones as ZoneNode)
      : isObj && ('full' in (raw as object) || 'cols' in (raw as object))
        ? legacyToZones(raw)
        : Array.isArray(raw)
          ? legacyToZones(raw)
          : null

  const placed = new Set<string>()

  // Recursive sanitize: validate shape defensively, dedupe cards pre-order,
  // clamp sizes, flatten past MAX_DEPTH, drop empty splits, collapse
  // single-child splits (child inherits the outer size).
  const sanitize = (node: unknown, depth: number): ZoneNode | null => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null
    const n = node as Record<string, unknown>
    const takeCards = (rawCards: unknown): string[] => {
      const out: string[] = []
      if (Array.isArray(rawCards)) {
        for (const c of rawCards) {
          if (typeof c === 'string' && CARD_SET.has(c) && !placed.has(c) && !hiddenSet.has(c)) {
            placed.add(c)
            out.push(c)
          }
        }
      }
      return out
    }
    if (Array.isArray(n.cards)) {
      const size = cleanSize(n.size)
      return { cards: takeCards(n.cards), ...(size != null ? { size } : {}) }
    }
    if ((n.dir === 'row' || n.dir === 'col') && Array.isArray(n.children)) {
      if (depth >= MAX_DEPTH) {
        // Too deep — flatten the whole subtree into one leaf, keeping card order.
        const cards: string[] = []
        const gather = (m: unknown) => {
          if (!m || typeof m !== 'object') return
          const mm = m as Record<string, unknown>
          if (Array.isArray(mm.cards)) cards.push(...takeCards(mm.cards))
          else if (Array.isArray(mm.children)) mm.children.forEach(gather)
        }
        gather(n)
        const size = cleanSize(n.size)
        return { cards, ...(size != null ? { size } : {}) }
      }
      const children = n.children.map((c) => sanitize(c, depth + 1)).filter((c): c is ZoneNode => c != null)
      if (children.length === 0) return null
      const size = cleanSize(n.size)
      if (children.length === 1) {
        const only = children[0]
        return size != null ? { ...only, size } : only
      }
      return { dir: n.dir, ...(size != null ? { size } : {}), children }
    }
    return null
  }

  let zones = source ? sanitize(source, 0) : null

  // Nothing placed AND nothing hidden → built-in default, returned as-is
  // (module cards are injected client-side when their module is on — appending
  // them here would defeat that gating). A fully-hidden layout is legitimate,
  // so keep its (possibly all-empty) zones.
  if (placed.size === 0 && hidden.length === 0) {
    return { zones: defaultZones(), hidden: [], ...(options ? { options } : {}) }
  }
  if (!zones) zones = { cards: [] }

  // Append any card not yet placed or hidden: everything to the last leaf,
  // except the week calendar, which gets its own full-width zone on top (its
  // designed band home — mirrors the old model's band default).
  const leaves: ZoneLeaf[] = []
  const collect = (n: ZoneNode) => (isLeaf(n) ? leaves.push(n) : n.children.forEach(collect))
  collect(zones)
  for (const k of TODAY_CARDS as readonly string[]) {
    if (placed.has(k) || hiddenSet.has(k) || k === FULL_DEFAULT_CARD) continue
    leaves[leaves.length - 1].cards.push(k)
    placed.add(k)
  }
  if (!placed.has(FULL_DEFAULT_CARD) && !hiddenSet.has(FULL_DEFAULT_CARD)) {
    const band: ZoneLeaf = { cards: [FULL_DEFAULT_CARD], size: 1 }
    if (!isLeaf(zones) && zones.dir === 'col') zones.children.unshift(band)
    else {
      // Wrapping adds a level, so pre-flatten anything already at the depth cap.
      zones = { dir: 'col', children: [band, flattenPastDepth(zones, MAX_DEPTH - 1)] }
    }
    placed.add(FULL_DEFAULT_CARD)
  }

  // Leaf cap (after appends, so the band counts too): merge overflow leaves'
  // cards into the last kept leaf.
  {
    const overflow: string[] = []
    let leafCount = 0
    let lastKept: ZoneLeaf | null = null
    const trim = (node: ZoneNode): ZoneNode | null => {
      if (isLeaf(node)) {
        leafCount++
        if (leafCount > MAX_LEAVES) {
          overflow.push(...node.cards)
          return null
        }
        lastKept = node
        return node
      }
      const children = node.children.map(trim).filter((c): c is ZoneNode => c != null)
      if (children.length === 0) return null
      if (children.length === 1) return { ...children[0], size: node.size ?? children[0].size }
      return { ...node, children }
    }
    zones = trim(zones) ?? { cards: [] }
    if (lastKept && overflow.length) (lastKept as ZoneLeaf).cards.push(...overflow)
  }

  // The root always renders as a split (a lone leaf gets wrapped).
  if (isLeaf(zones)) zones = { dir: 'col', children: [zones] }

  return { zones, hidden, ...(options ? { options } : {}) }
}

const isKnownKey = (k: unknown): k is string => typeof k === 'string' && CARD_SET.has(k)
const isKeyArray = (v: unknown) => v == null || (Array.isArray(v) && v.every(isKnownKey))

// A zone tree posted by a client: leaves list known cards; splits nest valid
// children; sizes, when present, are finite numbers.
function isZoneShape(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const n = raw as { cards?: unknown; dir?: unknown; children?: unknown; size?: unknown }
  const sizeOk = n.size == null || (typeof n.size === 'number' && Number.isFinite(n.size))
  if (n.cards != null) return sizeOk && Array.isArray(n.cards) && n.cards.every(isKnownKey)
  return sizeOk && (n.dir === 'row' || n.dir === 'col') && Array.isArray(n.children) && n.children.every(isZoneShape)
}

// A PUT body is a valid layout if it's a legacy array of arrays of known cards,
// the legacy tagged {full?, cols?, hidden?, bandHeight?, colWidths?} shape, or
// the v2 {zones, hidden?, options?} shape.
function isLayoutShape(raw: unknown): boolean {
  if (Array.isArray(raw)) {
    return raw.every((col) => Array.isArray(col) && col.every(isKnownKey))
  }
  if (!raw || typeof raw !== 'object') return false
  const o = raw as { zones?: unknown; full?: unknown; cols?: unknown; hidden?: unknown; bandHeight?: unknown; colWidths?: unknown; options?: unknown }
  if (o.zones != null) {
    const optionsOk = o.options == null || (typeof o.options === 'object' && !Array.isArray(o.options))
    return isZoneShape(o.zones) && isKeyArray(o.hidden) && optionsOk
  }
  if (o.cols == null && o.full == null) return false // must be a tagged layout
  const colsOk = o.cols == null || (Array.isArray(o.cols) && o.cols.every((col) => Array.isArray(col) && col.every(isKnownKey)))
  const bandOk = o.bandHeight == null || (typeof o.bandHeight === 'number' && Number.isFinite(o.bandHeight))
  const widthsOk = o.colWidths == null || (Array.isArray(o.colWidths) && o.colWidths.every((n) => typeof n === 'number' && Number.isFinite(n)))
  return colsOk && isKeyArray(o.full) && isKeyArray(o.hidden) && bandOk && widthsOk
}

export function registerTodayLayoutRoutes(api: Api): void {
  // The resolved layout the kiosk renders, plus both raw tiers so the Customize
  // UI can show which is in effect and offer "reset".
  api.get('/api/today-layout', tenantRoute(async (tenant) => {
    const { rows } = await query<{ family: unknown; user: unknown }>(
      `select h.today_layout as family, p.today_layout as user
         from persons p join households h on h.id = p.household_id
        where p.id = $1`,
      [tenant.personId]
    )
    const family = rows[0]?.family ?? null
    const user = rows[0]?.user ?? null
    const source = user != null ? 'user' : family != null ? 'family' : 'default'
    const resolved = reconcileLayout(user ?? family ?? null)
    // Only admins can change what the shared kiosk shows (the family tier).
    return { resolved, family: family ?? null, user: user ?? null, source, cards: TODAY_CARDS, canEditFamily: tenant.isAdmin }
  }))

  // Save the layout to one tier. scope 'family' is admin-only (it's what the
  // shared kiosk shows); scope 'user' writes the caller's own override.
  api.put('/api/today-layout', tenantRoute(async (tenant, req: Request, res: Response) => {
    const body = (req.body ?? {}) as { scope?: unknown; layout?: unknown }
    const scope = body.scope === 'family' ? 'family' : body.scope === 'user' ? 'user' : null
    if (!scope) return res.status(400).json({ error: 'BadRequest', message: 'scope must be "user" or "family"' })
    if (!isLayoutShape(body.layout)) {
      return res.status(400).json({ error: 'BadRequest', message: 'layout must be a zone tree or an array of arrays of known card keys' })
    }
    const layout: StoredLayout = reconcileLayout(body.layout)
    if (scope === 'family') {
      requireAdmin(tenant)
      await query(`update households set today_layout = $1 where id = $2`, [JSON.stringify(layout), tenant.householdId])
    } else {
      await query(`update persons set today_layout = $1 where id = $2`, [JSON.stringify(layout), tenant.personId])
    }
    return { ok: true, layout }
  }))

  // Reset a tier back to inheriting (user → family, family → built-in default).
  api.delete('/api/today-layout', tenantRoute(async (tenant, req: Request, res: Response) => {
    const scope = (req.query.scope as string) === 'family' ? 'family' : 'user'
    if (scope === 'family') {
      requireAdmin(tenant)
      await query(`update households set today_layout = null where id = $1`, [tenant.householdId])
    } else {
      await query(`update persons set today_layout = null where id = $1`, [tenant.personId])
    }
    return res.status(204).send('')
  }))
}
