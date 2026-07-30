// Today dashboard layout — a family default (households.today_layout) plus an
// optional per-person override (persons.today_layout). The resolved layout the
// kiosk renders is user ?? family ?? the built-in default, always reconciled
// against the canonical card set so newly added cards appear and removed/unknown
// keys are dropped (a card is never lost or duplicated).
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
type CardKey = (typeof TODAY_CARDS)[number]
const CARD_SET = new Set<string>(TODAY_CARDS)

// The Today grid is a fixed 3 columns on the kiosk (CSS stacks them on narrow
// screens). Layouts are always normalized to exactly 3 columns — empty columns
// are allowed and kept, so the structure stays stable across reloads.
const COLS = 3
// Cards that render full-width in the band above the columns. The week calendar
// is the designed full-width card, so an unplaced one defaults to the band.
const FULL_DEFAULT_CARD = 'weekCalendar'
// The built-in default arrangement: the week calendar spans the full-width band
// on top, the rest fill the 3 columns below (mirrors the FamilyBoard layout).
const DEFAULT_FULL: string[] = [FULL_DEFAULT_CARD]
const DEFAULT_COLS: string[][] = [['agenda', 'countdowns'], ['tonight', 'week'], ['chores', 'grocery']]
// Band height + per-column width ratios are user-resizable (Customize dividers);
// clamp to sane bounds so a bad value can't break the grid.
const BAND_MIN = 160
const BAND_MAX = 900
const COLW_MIN = 0.4
const COLW_MAX = 3

// A normalized layout: a full-width band, the 3-column card grid, the cards the
// user has explicitly hidden, and optional zone sizes (band height + column
// width ratios). Hidden cards are kept out of the band AND columns AND the
// missing-append pass, so a card the user removed stays removed (module cards
// like grocery/goals otherwise pop back on every reconcile).
export interface StoredLayout {
  full: string[]
  cols: string[][]
  hidden: string[]
  bandHeight?: number
  colWidths?: number[]
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// A finite band height clamped to bounds, or undefined if the input isn't usable.
function cleanBandHeight(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, BAND_MIN, BAND_MAX) : undefined
}

// Column width ratios: exactly COLS finite positives, each clamped — else dropped.
function cleanColWidths(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length !== COLS) return undefined
  if (!raw.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) return undefined
  return raw.map((n) => clamp(n, COLW_MIN, COLW_MAX))
}

// Pull a clean, deduped list of known card keys out of arbitrary json.
function cleanKeys(raw: unknown, skip?: Set<string>): { keys: string[]; seen: Set<string> } {
  const keys: string[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw)) {
    for (const k of raw) {
      if (typeof k === 'string' && CARD_SET.has(k) && !seen.has(k) && !skip?.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  return { keys, seen }
}

// Coerce arbitrary stored/posted json into a clean {full, cols, hidden, sizes}:
// keep the given band + column order, drop unknown/duplicate/hidden keys, merge
// overflow columns into the last, then append any missing (not-placed, not-hidden)
// card — the week calendar to the band, everything else to the last column — so
// nothing is lost as the card set grows. Accepts the {full, cols, hidden} shape,
// the older {cols, hidden} shape, and a legacy bare `string[][]`.
export function reconcileLayout(raw: unknown): StoredLayout {
  const isTagged = !!raw && typeof raw === 'object' && !Array.isArray(raw) && ('cols' in (raw as object) || 'full' in (raw as object))
  const rawFull = isTagged ? (raw as { full?: unknown }).full : undefined
  const rawCols = isTagged ? (raw as { cols?: unknown }).cols : raw
  const rawHidden = isTagged ? (raw as { hidden?: unknown }).hidden : undefined
  const bandHeight = cleanBandHeight(isTagged ? (raw as { bandHeight?: unknown }).bandHeight : undefined)
  const colWidths = cleanColWidths(isTagged ? (raw as { colWidths?: unknown }).colWidths : undefined)
  const sizes = { ...(bandHeight != null ? { bandHeight } : {}), ...(colWidths != null ? { colWidths } : {}) }

  const { keys: hidden, seen: hiddenSet } = cleanKeys(rawHidden)
  // Band first — a card in the band is "placed" and won't be duplicated in a column.
  const { keys: full, seen: placed } = cleanKeys(rawFull, hiddenSet)

  const cols: string[][] = [[], [], []]
  if (Array.isArray(rawCols)) {
    rawCols.forEach((col, ci) => {
      if (!Array.isArray(col)) return
      const target = Math.min(ci, COLS - 1) // columns past the 3rd merge into it
      for (const key of col) {
        if (typeof key === 'string' && CARD_SET.has(key) && !placed.has(key) && !hiddenSet.has(key)) {
          placed.add(key)
          cols[target].push(key)
        }
      }
    })
  }
  // Nothing placed AND nothing hidden → built-in default (don't dump every card
  // into one column). A fully-hidden layout is legitimate, so keep it.
  if (placed.size === 0 && hidden.length === 0) {
    return { full: [...DEFAULT_FULL], cols: DEFAULT_COLS.map((c) => [...c]), hidden: [], ...sizes }
  }
  // Append any card not yet placed or hidden: the week calendar defaults to the
  // band (its designed home), everything else to the last column.
  for (const k of TODAY_CARDS as readonly string[]) {
    if (placed.has(k) || hiddenSet.has(k)) continue
    if (k === FULL_DEFAULT_CARD) full.push(k)
    else cols[COLS - 1].push(k)
    placed.add(k)
  }
  return { full, cols, hidden, ...sizes }
}

const isKnownKey = (k: unknown): k is string => typeof k === 'string' && CARD_SET.has(k)
const isKeyArray = (v: unknown) => v == null || (Array.isArray(v) && v.every(isKnownKey))

// A POST body is a valid layout if it's a legacy array of arrays of known cards,
// or the tagged {full?, cols?, hidden?, bandHeight?, colWidths?} shape with known
// keys and numeric sizes.
function isLayoutShape(raw: unknown): boolean {
  if (Array.isArray(raw)) {
    return raw.every((col) => Array.isArray(col) && col.every(isKnownKey))
  }
  if (!raw || typeof raw !== 'object') return false
  const o = raw as { full?: unknown; cols?: unknown; hidden?: unknown; bandHeight?: unknown; colWidths?: unknown }
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
      return res.status(400).json({ error: 'BadRequest', message: 'layout must be an array of arrays of known card keys' })
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
