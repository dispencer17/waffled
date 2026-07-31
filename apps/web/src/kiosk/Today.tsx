import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { AgendaCard } from './components/AgendaCard'
import { WeekCalendarCard } from './components/WeekCalendarCard'
import { TonightCardSlot, WeekDinnersCard } from './components/MealsColumn'
import { ChoresCard } from './components/ChoresCard'
import { GroceryCard } from './components/GroceryCard'
import { CountdownsCard } from './components/CountdownsCard'
import { FamilyNightCard } from './components/FamilyNightCard'
import { QuickControlsCard } from './components/QuickControls'
import { GoalSpotlightCard } from './components/GoalSpotlightCard'
import { RewardsCard } from './components/RewardsCard'
import { GoalRecapBar } from './components/GoalRecap'
import { ApprovalsBar } from './components/Approvals'
import { CaptureBar } from './components/CaptureBar'
import { GettingStartedBar } from './onboarding/GettingStarted'
import { PantryCard } from './Pantry'
import { useTopbarRight } from './topbar-slot'
import { useTodayLayout, useHousehold, type LayoutScope, type StoredLayout, type BoardOptions } from '../lib/api'
import { moduleEnabled, rewardsEnabled } from '../lib/modules'
import {
  isLeaf,
  getNode,
  splitZone,
  deleteZone,
  listLeaves,
  resizeSiblings,
  setZoneSize,
  removeCardEverywhere,
  insertAtZone,
  appendCard,
  applyModuleCard,
  hideModuleCard,
  dropTargetAt,
  SIZE_MIN,
  SIZE_MAX,
  type ZoneNode,
  type ZonePath,
} from './zone-layout'
import { TODAY_PRESETS, applyPreset, type TodayPreset } from './today-presets'

// The cards that can live on Today, keyed the same as the stored layout. `fill`
// cards are long, scrollable lists (agenda, grocery) — they take the spare room in
// their zone and scroll INSIDE the card, so a 30-item grocery list never stretches
// the zone. Everything else sizes to its content (never shrinks/clips). The label
// shows in the Customize drag bar (and covers cards that render nothing, like
// Tonight with no dinner planned).
const CARDS: Record<string, { label: string; node: ReactNode; fill?: boolean }> = {
  agenda: { label: 'Agenda', node: <AgendaCard />, fill: true },
  tonight: { label: "Tonight's dinner", node: <TonightCardSlot /> },
  week: { label: "This week's dinners", node: <WeekDinnersCard /> },
  chores: { label: 'Family Chores', node: <ChoresCard /> },
  rewards: { label: 'Rewards', node: <RewardsCard /> },
  grocery: { label: 'Grocery', node: <GroceryCard />, fill: true },
  countdowns: { label: 'Countdowns', node: <CountdownsCard /> },
  familyNight: { label: 'Family Night', node: <FamilyNightCard /> },
  goals: { label: 'Goals', node: <GoalSpotlightCard /> },
  pantry: { label: 'Pantry', node: <PantryCard /> },
  smartHome: { label: 'Smart Home', node: <QuickControlsCard /> },
  weekCalendar: { label: 'Week calendar', node: <WeekCalendarCard />, fill: true },
}

// Pure zone-tree helpers + drop-target math live in zone-layout.ts (tested).

// Live drag: how long a press must hold still to lift a card, and how far the
// pointer may wander during the hold before we treat the gesture as a scroll.
const HOLD_MS = 450
const HOLD_SLOP = 8

// Zone sizing: sizes are flex ratios. In a row split they divide the width; in
// a col split an explicit size pins the zone's height at size × VZONE_PX
// (ratio-less zones take their content height). Pixel↔ratio conversions mirror
// the server (modules/layout/today-layout.ts).
const VZONE_PX = 320
// Pixels of horizontal drag ≈ one width-ratio unit (≈ a zone's width).
const COL_RESIZE_REF = 220
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// The kiosk "Today" dashboard. Cards are arranged from a saved layout (family
// default + optional per-person override): a FancyZones-style zone tree —
// recursive row/col splits whose leaves stack cards. Cards can be dragged
// directly on the board (long-press to lift, target zone highlights) or
// rearranged in a Customize mode — where zones can also be split, deleted, and
// resized via their dividers — then saved for you or the family.  // fork
export function Today() {
  const { resolved, source, loading, save, reset } = useTodayLayout()
  const { household } = useHousehold()
  // Optional-module cards: shown when the module is enabled and not hidden from Today.
  // Pantry appears when on (not in the default layout); chores/meals/grocery cards
  // ship in the default layout, so we only strip them when their module is off.
  const showPantry = moduleEnabled(household, 'pantry') && household?.settings?.pantry?.showOnToday !== false
  const showChores = moduleEnabled(household, 'chores')
  const showMeals = moduleEnabled(household, 'meals')
  const showGrocery = moduleEnabled(household, 'lists')
  const showFamilyNight = moduleEnabled(household, 'familyNight') && household?.settings?.familyNight?.showOnToday !== false
  const showGoals = moduleEnabled(household, 'goals')
  const showSmartHome = moduleEnabled(household, 'smartHome')
  // Rewards is a sub-toggle of chores, not its own module — bespoke gate.
  const showRewards = rewardsEnabled(household)
  // Whether each card is available to show at all (its module is on). Cards with
  // no module gate are always available. Drives which hidden cards can be brought
  // back from the tray — showing one whose module is off would just get stripped.
  const cardAvailable = useMemo<Record<string, boolean>>(
    () => ({
      pantry: showPantry,
      familyNight: showFamilyNight,
      goals: showGoals,
      chores: showChores,
      tonight: showMeals,
      week: showMeals,
      grocery: showGrocery,
      smartHome: showSmartHome,
      rewards: showRewards,
    }),
    [showPantry, showFamilyNight, showGoals, showChores, showMeals, showGrocery, showSmartHome, showRewards]
  )
  const isAvailable = (card: string) => cardAvailable[card] ?? true
  const effectiveResolved = useMemo<StoredLayout>(() => {
    const hidden = resolved.hidden
    // Default-tree leaf paths: '0' band, '1.0'..'1.2' columns — the prefer
    // paths keep module cards landing where the old board put them.
    let z = applyModuleCard(resolved.zones, 'pantry', showPantry, hidden, '1.1')
    z = applyModuleCard(z, 'familyNight', showFamilyNight, hidden)
    z = applyModuleCard(z, 'goals', showGoals, hidden, '1.0')
    z = applyModuleCard(z, 'smartHome', showSmartHome, hidden)
    z = hideModuleCard(z, 'chores', showChores)
    z = hideModuleCard(z, 'tonight', showMeals)
    z = hideModuleCard(z, 'week', showMeals)
    z = hideModuleCard(z, 'grocery', showGrocery)
    // Rewards arrives via the server's reconcile append (it's in TODAY_CARDS);
    // here we only strip it when the rewards toggle is off.
    z = hideModuleCard(z, 'rewards', showRewards)
    return { zones: z, hidden, ...(resolved.options ? { options: resolved.options } : {}) }
  }, [resolved, showPantry, showFamilyNight, showGoals, showChores, showMeals, showGrocery, showSmartHome, showRewards])

  const [editing, setEditing] = useState(false)
  const [zones, setZones] = useState<ZoneNode>(effectiveResolved.zones)
  const [hidden, setHidden] = useState<string[]>(effectiveResolved.hidden)
  const [options, setOptions] = useState<BoardOptions>(effectiveResolved.options ?? {})
  const [saving, setSaving] = useState(false)

  // Pointer drag state (Customize chips AND live long-press drags). `drag` is set
  // once per drag so the listener effect subscribes once; `pos` drives the ghost,
  // `target` the drop indicator (read live via ref on drop). A live drag
  // (`live: true`) starts from a long-press on the board and auto-saves on drop.
  const [drag, setDrag] = useState<{ card: string; live?: boolean } | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [target, setTarget] = useState<{ path: ZonePath; index: number } | null>(null)
  const targetRef = useRef<{ path: ZonePath; index: number } | null>(null)
  targetRef.current = target
  // While a live drop's PUT is in flight, render its tree (covers the gap until
  // the hook's optimistic update lands); reverts on failure. Refs keep the drag
  // effect subscribed once per drag without stale closures.
  const [liveOverride, setLiveOverride] = useState<ZoneNode | null>(null)
  const resolvedRef = useRef(effectiveResolved)
  resolvedRef.current = effectiveResolved
  const saveRef = useRef(save)
  saveRef.current = save
  // True while a zone divider is being dragged, so the resolved→working sync below
  // doesn't clobber the in-progress size (and, in view mode, the just-saved one).
  const resizingRef = useRef(false)
  // The current working tree + hidden set — read on drop without a stale closure.
  const zonesRef = useRef<ZoneNode>(zones)
  zonesRef.current = zones
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Keep the working copy in sync with the server layout (+ module cards) when not
  // editing — but never mid-resize, so a live divider drag isn't reverted.
  useEffect(() => {
    if (!editing && !resizingRef.current) {
      setZones(effectiveResolved.zones)
      setHidden(effectiveResolved.hidden)
      setOptions(effectiveResolved.options ?? {})
    }
  }, [effectiveResolved, editing])

  // What the working state saves as (working options ride along on every save).
  function toStored(z: ZoneNode, h: string[]): StoredLayout {
    const o = optionsRef.current
    return { zones: z, hidden: h, ...(Object.keys(o).length ? { options: o } : {}) }
  }

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      setPos({ x: e.clientX, y: e.clientY })
      setTarget(dropTargetAt(e.clientX, e.clientY))
    }
    const drop = () => {
      const t = targetRef.current
      if (t) {
        if (drag.live) {
          // Live drag: apply and persist as the personal layout in one go.
          const base = resolvedRef.current
          const next = insertAtZone(base.zones, drag.card, t.path, t.index)
          setLiveOverride(next)
          saveRef
            .current('user', toStored(next, base.hidden))
            .catch(() => {}) // clearing liveOverride below reverts to the server layout
            .finally(() => setLiveOverride(null))
        } else {
          setZones(insertAtZone(zonesRef.current, drag.card, t.path, t.index))
        }
      }
      setDrag(null)
      setTarget(null)
    }
    const cancel = () => {
      setDrag(null)
      setTarget(null)
    }
    // A lifted card owns the gesture: no native scroll while dragging, and the
    // trailing click (press + release over card content) never reaches the card.
    const blockScroll = (e: TouchEvent) => e.preventDefault()
    const swallowClick = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', drop)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('touchmove', blockScroll, { passive: false })
    window.addEventListener('click', swallowClick, true)
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', drop)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchmove', blockScroll)
      // Deferred: the click trailing this drag's pointerup must still be swallowed.
      window.setTimeout(() => window.removeEventListener('click', swallowClick, true), 0)
      document.body.style.userSelect = ''
    }
  }, [drag])

  // Customize button lives in the topbar, to the left of the "Add anything" bar.
  // Only shown in view mode; the edit toolbar below handles save/cancel. (layout
  // is kept synced to resolved while not editing, so entering edit needs no snapshot.)
  useTopbarRight(
    () =>
      editing ? (
        <CaptureBar />
      ) : (
        <div className="tb-today-actions">
          <button type="button" className="pill today-customize" disabled={loading} onClick={() => setEditing(true)}>
            ⠿ Customize
            {source === 'user' && <span className="today-src-tag">personal</span>}
          </button>
          <CaptureBar />
        </div>
      ),
    [editing, source, loading]
  )

  // Customize-mode chip drag: lift immediately from the drag bar.
  function startDrag(e: ReactPointerEvent, card: string) {
    e.preventDefault()
    setPos({ x: e.clientX, y: e.clientY })
    setTarget(null)
    setDrag({ card })
  }

  // Live drag entry: a long-press (hold still) on a card lifts it without
  // entering Customize. Presses on interactive content, or a finger that moves
  // (scrolls) past the slop before the hold fires, never lift — and native
  // scroll cancels the hold via pointercancel.
  function beginHold(e: ReactPointerEvent, card: string) {
    if (editing || drag || loading) return
    if ((e.target as Element).closest('button, a, input, select, textarea, [role="button"]')) return
    const x0 = e.clientX
    const y0 = e.clientY
    const stop = () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > HOLD_SLOP || Math.abs(ev.clientY - y0) > HOLD_SLOP) stop()
    }
    const timer = window.setTimeout(() => {
      stop()
      setPos({ x: x0, y: y0 })
      setTarget(null)
      setDrag({ card, live: true })
    }, HOLD_MS)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  // Zone dividers live on the normal dashboard AND in Customize. Dragging updates
  // the working tree live; on the normal board it auto-saves to the personal
  // layout on release (like live card drag), while in Customize it persists with
  // Save. A divider between siblings of a row split rebalances their width
  // ratios; in a col split it drags the upper sibling's pinned height.
  function startZoneResize(e: ReactPointerEvent, parentPath: ZonePath, i: number, dir: 'row' | 'col') {
    if (drag) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const base = zonesRef.current
    let latest = base
    resizingRef.current = true
    const childPath = parentPath ? `${parentPath}.${i}` : String(i)
    const startSize = (getNode(base, childPath) as { size?: number } | null)?.size ?? 1
    const move = (ev: PointerEvent) => {
      if (dir === 'row') {
        const d = (ev.clientX - startX) / COL_RESIZE_REF
        latest = resizeSiblings(base, parentPath, i, d)
      } else {
        const ratio = clamp(startSize + (ev.clientY - startY) / VZONE_PX, SIZE_MIN, SIZE_MAX)
        latest = setZoneSize(base, childPath, ratio)
      }
      setZones(latest)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      resizingRef.current = false
      if (!editing && latest !== base) saveRef.current('user', toStored(latest, hiddenRef.current)).catch(() => {})
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.userSelect = 'none'
  }

  // Zone tools (Customize): split a leaf into side-by-side / stacked zones, or
  // delete it (its cards merge into the neighbor).
  function doSplit(path: ZonePath, dir: 'row' | 'col') {
    setZones((z) => splitZone(z, path, dir))
  }
  function doDelete(path: ZonePath) {
    setZones((z) => deleteZone(z, path))
  }

  // Apply a Customize preset to the working layout (filtered to available cards);
  // the user then tweaks and saves. Replaces the whole arrangement.
  function applyWorkingPreset(p: TodayPreset) {
    const next = applyPreset(p, isAvailable)
    setZones(next.zones)
    setHidden(next.hidden)
  }

  function cancel() {
    setEditing(false)
    setDrag(null)
    setZones(effectiveResolved.zones)
    setHidden(effectiveResolved.hidden)
    setOptions(effectiveResolved.options ?? {})
  }
  // Hide a card from Today: pull it out of the tree and remember it as hidden,
  // so it stays gone (and, for module cards, doesn't auto-reappear) until shown.
  function hideCard(card: string) {
    setZones((z) => removeCardEverywhere(z, card))
    setHidden((prev) => (prev.includes(card) ? prev : [...prev, card]))
  }
  // Bring a hidden card back — drop it from `hidden` and append it to a zone.
  function showCard(card: string) {
    setHidden((prev) => prev.filter((c) => c !== card))
    setZones((z) => appendCard(z, card))
  }
  async function persist(scope: LayoutScope) {
    setSaving(true)
    try {
      await save(scope, toStored(zones, hidden))
      setEditing(false)
      setDrag(null)
    } finally {
      setSaving(false)
    }
  }
  async function resetDefault() {
    setSaving(true)
    try {
      await reset('user')
      setEditing(false)
      setDrag(null)
    } finally {
      setSaving(false)
    }
  }

  // What to render: the working tree (kept in sync with the resolved layout
  // while not editing), or a just-dropped live tree while its PUT is in flight.
  // The dragged card is NOT removed — it renders in place as a dimmed source
  // (see renderCard), which keeps its DOM node mounted so a touch pointer's
  // implicit capture isn't lost (removing it fires pointercancel → snap-back).
  const displayZones: ZoneNode = editing ? zones : liveOverride ?? zones
  // Hidden cards the user could bring back — only those whose module is on.
  const hiddenShowable = hidden.filter((c) => CARDS[c] && isAvailable(c))
  const lastLeaf = listLeaves(displayZones).length <= 1

  // One card in a zone: the drop-line before it (when it's the target slot), then
  // the card. The dragged card keeps rendering (DOM stays mounted) but drops its
  // `data-card` so dropTargetAt skips it, and dims via `dragging-source`.
  function renderCard(card: string, path: ZonePath, idx: number) {
    const def = CARDS[card]
    if (!def) return null
    const dragged = drag?.card === card
    return (
      <Fragment key={card}>
        {drag && target?.path === path && target?.index === idx && <div className="today-drop-line" />}
        {editing ? (
          <div className={`today-card-wrap compact ${dragged ? 'dragging-source' : ''}`} data-card={dragged ? undefined : card}>
            <div className="today-card-bar" onPointerDown={(e) => startDrag(e, card)}>
              <span className="today-card-grip">⠿</span>
              <span className="today-card-name">{def.label}</span>
              {def.fill && <span className="today-card-fillhint">list</span>}
              <button
                type="button"
                className="today-card-hide"
                title="Hide from Today"
                aria-label={`Hide ${def.label}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => hideCard(card)}
              >
                ×
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`today-slot ${def.fill ? 'fill' : ''} ${dragged ? 'dragging-source' : ''}`}
            data-card={dragged ? undefined : card}
            onPointerDown={(e) => beginHold(e, card)}
          >
            {def.node}
          </div>
        )}
      </Fragment>
    )
  }
  // The trailing drop-line (dropping at the end of a zone) + the empty-zone hint.
  function renderZoneTail(cards: string[], path: ZonePath) {
    return (
      <>
        {drag && target?.path === path && target?.index === cards.length && <div className="today-drop-line" />}
        {(editing || !!drag) && cards.length === 0 && <div className="today-col-empty">Drop a card here</div>}
      </>
    )
  }

  // Recursive zone render. A leaf is a drop region (data-region=path) stacking
  // its cards; a split lays its children out with draggable dividers between
  // them. Sizing: row-split children flex by --z-size; col-split children with
  // an explicit size pin their height via --z-h.
  function renderZone(node: ZoneNode, path: ZonePath, parentDir: 'row' | 'col' | null): ReactNode {
    const sized = node.size != null
    const style: CSSProperties =
      parentDir === 'col'
        ? sized
          ? ({ '--z-h': `${Math.round((node.size ?? 1) * VZONE_PX)}px` } as CSSProperties)
          : {}
        : ({ '--z-size': node.size ?? 1 } as CSSProperties)
    if (isLeaf(node)) {
      return (
        <div
          key={path || 'root'}
          className={`today-zone ${parentDir === 'col' && sized ? 'today-zone--pinned' : ''} ${drag && target?.path === path ? 'zone-drop-active' : ''}`}
          data-region={path}
          style={style}
        >
          {editing && (
            <div className="today-zone-tools">
              <button type="button" className="today-zone-tool" title="Split into side-by-side zones" aria-label="Split zone horizontally" onClick={() => doSplit(path, 'row')}>
                ◫
              </button>
              <button type="button" className="today-zone-tool" title="Split into stacked zones" aria-label="Split zone vertically" onClick={() => doSplit(path, 'col')}>
                ⬓
              </button>
              <button type="button" className="today-zone-tool danger" title={lastLeaf ? 'The last zone cannot be deleted' : 'Delete this zone (cards move to its neighbor)'} aria-label="Delete zone" disabled={lastLeaf} onClick={() => doDelete(path)}>
                ×
              </button>
            </div>
          )}
          {node.cards.map((card, idx) => renderCard(card, path, idx))}
          {renderZoneTail(node.cards, path)}
        </div>
      )
    }
    return (
      <div key={path || 'root'} className={`today-zone-split ${parentDir === 'col' && sized ? 'today-zone--pinned' : ''}`} data-dir={node.dir} style={style}>
        {node.children.map((child, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <div
                className={node.dir === 'col' ? 'today-divider-h' : 'today-divider-v'}
                onPointerDown={(e) => startZoneResize(e, path, i - 1, node.dir)}
                title="Drag to resize"
              >
                <span className="today-divider-grip" />
              </div>
            )}
            {renderZone(child, path ? `${path}.${i}` : String(i), node.dir)}
          </Fragment>
        ))}
      </div>
    )
  }

  return (
    <div className={`today-wrap ${editing ? 'today-editing' : ''} ${drag ? 'today-dragging' : ''} ${options.density === 'compact' ? 'density-compact' : ''}`}>
      <GettingStartedBar />
      {(showChores || rewardsEnabled(household)) && <ApprovalsBar />}
      {moduleEnabled(household, 'goals') && <GoalRecapBar />}

      {editing && (
        <div className="today-toolbar">
          <span className="tiny muted today-toolbar-hint">Drag cards to rearrange; split, delete, and resize zones</span>
          <button type="button" className="pill" style={{ cursor: 'pointer' }} disabled={saving} onClick={cancel}>Cancel</button>
          <button type="button" className="pill" style={{ cursor: 'pointer' }} disabled={saving} onClick={resetDefault}>Reset to defaults</button>
          <button type="button" className="pill btn-primary" style={{ color: 'var(--on-accent)', border: 0, cursor: 'pointer' }} disabled={saving} onClick={() => persist('user')}>Save for me</button>
        </div>
      )}
      {editing && (
        <div className="today-presets">
          <span className="tiny muted today-presets-h">Start from a layout:</span>
          {TODAY_PRESETS.map((p) => (
            <button key={p.id} type="button" className="pill today-preset-pill" title={p.sub} disabled={saving} onClick={() => applyWorkingPreset(p)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      {/* Board options — the signal-to-noise dials, saved with the layout. */}
      {editing && (
        <div className="today-options">
          <span className="tiny muted today-options-h">Board options:</span>
          <label className="today-option">
            <button
              type="button"
              role="switch"
              aria-checked={!!options.hideEmpty}
              aria-label="Hide empty cards"
              className={`toggle ${options.hideEmpty ? 'on' : ''}`}
              onClick={() => setOptions((o) => ({ ...o, hideEmpty: !o.hideEmpty }))}
            />
            <span>Hide empty cards</span>
          </label>
          <label className="today-option">
            <span>Density</span>
            <select
              className="sel"
              aria-label="Density"
              value={options.density ?? 'cozy'}
              onChange={(e) => setOptions((o) => ({ ...o, density: e.target.value === 'compact' ? 'compact' : 'cozy' }))}
            >
              <option value="cozy">Cozy</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </div>
      )}

      <div className={`today-board today-zones ${editing ? 'editing' : ''} ${drag ? 'dragging' : ''}`}>
        {renderZone(displayZones, '', null)}
      </div>

      {editing && (
        <div className="today-hidden-tray">
          <div className="today-hidden-tray-h">Hidden cards</div>
          {hiddenShowable.length === 0 ? (
            <div className="today-hidden-empty">Tap × on a card to hide it from Today. Hidden cards appear here to add back.</div>
          ) : (
            <div className="today-hidden-chips">
              {hiddenShowable.map((card) => (
                <button key={card} type="button" className="today-hidden-chip" onClick={() => showCard(card)}>
                  <span className="plus">+</span>
                  {CARDS[card].label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {drag && (
        <div className="today-drag-ghost" style={{ left: pos.x, top: pos.y }}>
          ⠿ {CARDS[drag.card]?.label}
        </div>
      )}
    </div>
  )
}
