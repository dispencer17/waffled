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
import { GoalRecapBar } from './components/GoalRecap'
import { ApprovalsBar } from './components/Approvals'
import { CaptureBar } from './components/CaptureBar'
import { GettingStartedBar } from './onboarding/GettingStarted'
import { PantryCard } from './Pantry'
import { useTopbarRight } from './topbar-slot'
import { useTodayLayout, useHousehold, type LayoutScope, type StoredLayout } from '../lib/api'
import { moduleEnabled, rewardsEnabled } from '../lib/modules'
import { appendToColumn, applyModuleCard, hideModuleCard, removeCardEverywhere, insertAtRegion, dropTargetAt, type Region, type RegionLayout } from './today-layout-utils'
import { TODAY_PRESETS, applyPreset, type TodayPreset } from './today-presets'

// The cards that can live on Today, keyed the same as the stored layout. `fill`
// cards are long, scrollable lists (agenda, grocery) — they take the spare room in
// their column and scroll INSIDE the card, so a 30-item grocery list never stretches
// the column. Everything else sizes to its content (never shrinks/clips). The label
// shows in the Customize drag bar (and covers cards that render nothing, like
// Tonight with no dinner planned).
const CARDS: Record<string, { label: string; node: ReactNode; fill?: boolean }> = {
  agenda: { label: 'Agenda', node: <AgendaCard />, fill: true },
  tonight: { label: "Tonight's dinner", node: <TonightCardSlot /> },
  week: { label: "This week's dinners", node: <WeekDinnersCard /> },
  chores: { label: 'Family Chores', node: <ChoresCard /> },
  grocery: { label: 'Grocery', node: <GroceryCard />, fill: true },
  countdowns: { label: 'Countdowns', node: <CountdownsCard /> },
  familyNight: { label: 'Family Night', node: <FamilyNightCard /> },
  goals: { label: 'Goals', node: <GoalSpotlightCard /> },
  pantry: { label: 'Pantry', node: <PantryCard /> },
  smartHome: { label: 'Smart Home', node: <QuickControlsCard /> },
  weekCalendar: { label: 'Week calendar', node: <WeekCalendarCard />, fill: true },
}

// Pure layout helpers + drop-target math live in today-layout-utils.ts (tested).

// Live drag: how long a press must hold still to lift a card, and how far the
// pointer may wander during the hold before we treat the gesture as a scroll.
const HOLD_MS = 450
const HOLD_SLOP = 8

// Zone-size bounds (mirror the server clamps in modules/layout/today-layout.ts).
const BAND_MIN = 160
const BAND_MAX = 900
const BAND_DEFAULT = 320 // starting band height when none is saved yet
const COLW_MIN = 0.4
const COLW_MAX = 3
// Pixels of horizontal drag ≈ one column-width ratio unit (≈ a column's width).
const COL_RESIZE_REF = 220
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// The kiosk "Today" dashboard. Cards are arranged from a saved layout (family
// default + optional per-person override): a full-width band on top (the week
// calendar by default) plus 3 columns below. Cards can be dragged directly on
// the board (long-press to lift) or rearranged in a Customize mode — where zone
// dividers also resize the band + columns — then saved for you or the family.
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
    }),
    [showPantry, showFamilyNight, showGoals, showChores, showMeals, showGrocery, showSmartHome]
  )
  const isAvailable = (card: string) => cardAvailable[card] ?? true
  const effectiveResolved = useMemo<StoredLayout>(() => {
    const hidden = resolved.hidden
    let cols = applyModuleCard(resolved.cols, 'pantry', showPantry, hidden, 1) // pantry → middle column by default
    cols = applyModuleCard(cols, 'familyNight', showFamilyNight, hidden)
    cols = applyModuleCard(cols, 'goals', showGoals, hidden, 0) // goals → left column by default
    cols = applyModuleCard(cols, 'smartHome', showSmartHome, hidden)
    cols = hideModuleCard(cols, 'chores', showChores)
    cols = hideModuleCard(cols, 'tonight', showMeals)
    cols = hideModuleCard(cols, 'week', showMeals)
    cols = hideModuleCard(cols, 'grocery', showGrocery)
    // The band passes through untouched, minus any module-off card that somehow
    // landed there (defensive — normally only the never-gated week calendar).
    const full = resolved.full.filter((c) => CARDS[c] && (cardAvailable[c] ?? true))
    return { full, cols, hidden, bandHeight: resolved.bandHeight, colWidths: resolved.colWidths }
  }, [resolved, cardAvailable, showPantry, showFamilyNight, showGoals, showChores, showMeals, showGrocery, showSmartHome])

  const [editing, setEditing] = useState(false)
  const [full, setFull] = useState<string[]>(effectiveResolved.full)
  const [layout, setLayout] = useState<string[][]>(effectiveResolved.cols)
  const [hidden, setHidden] = useState<string[]>(effectiveResolved.hidden)
  const [bandHeight, setBandHeight] = useState<number | undefined>(effectiveResolved.bandHeight)
  const [colWidths, setColWidths] = useState<number[] | undefined>(effectiveResolved.colWidths)
  const [saving, setSaving] = useState(false)

  // Pointer drag state (Customize chips AND live long-press drags). `drag` is set
  // once per drag so the listener effect subscribes once; `pos` drives the ghost,
  // `target` the drop indicator (read live via ref on drop). A live drag
  // (`live: true`) starts from a long-press on the board and auto-saves on drop.
  const [drag, setDrag] = useState<{ card: string; live?: boolean } | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [target, setTarget] = useState<{ region: Region; index: number } | null>(null)
  const targetRef = useRef<{ region: Region; index: number } | null>(null)
  targetRef.current = target
  // While a live drop's PUT is in flight, render its layout (covers the gap until
  // the hook's optimistic update lands); reverts on failure. Refs keep the drag
  // effect subscribed once per drag without stale closures.
  const [liveOverride, setLiveOverride] = useState<RegionLayout | null>(null)
  const resolvedRef = useRef(effectiveResolved)
  resolvedRef.current = effectiveResolved
  const saveRef = useRef(save)
  saveRef.current = save
  // The current working region layout (edit mode) — read on drop without a stale closure.
  const workingRef = useRef<RegionLayout>({ full, cols: layout })
  workingRef.current = { full, cols: layout }

  // Keep the working copy in sync with the server layout (+ module cards) when not editing.
  useEffect(() => {
    if (!editing) {
      setFull(effectiveResolved.full)
      setLayout(effectiveResolved.cols)
      setHidden(effectiveResolved.hidden)
      setBandHeight(effectiveResolved.bandHeight)
      setColWidths(effectiveResolved.colWidths)
    }
  }, [effectiveResolved, editing])

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
          const next = insertAtRegion({ full: base.full, cols: base.cols }, drag.card, t.region, t.index)
          setLiveOverride(next)
          const toSave: StoredLayout = {
            full: next.full,
            cols: next.cols,
            hidden: base.hidden,
            ...(base.bandHeight != null ? { bandHeight: base.bandHeight } : {}),
            ...(base.colWidths ? { colWidths: base.colWidths } : {}),
          }
          saveRef
            .current('user', toSave)
            .catch(() => {}) // clearing liveOverride below reverts to the server layout
            .finally(() => setLiveOverride(null))
        } else {
          const next = insertAtRegion(workingRef.current, drag.card, t.region, t.index)
          setFull(next.full)
          setLayout(next.cols)
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

  // Customize-only zone dividers. Dragging updates the working size; it persists
  // with "Save for me" (like the rest of the Customize edits), not on release.
  function startBandResize(e: ReactPointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startH = bandHeight ?? BAND_DEFAULT
    const move = (ev: PointerEvent) => setBandHeight(clamp(startH + (ev.clientY - startY), BAND_MIN, BAND_MAX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.userSelect = 'none'
  }
  // Resize the boundary between column `i` and `i+1`: shift ratio between the two.
  function startColResize(e: ReactPointerEvent, i: number) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const base = colWidths ?? layout.map(() => 1)
    const wi = base[i] ?? 1
    const wj = base[i + 1] ?? 1
    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - startX) / COL_RESIZE_REF
      const next = base.slice()
      next[i] = clamp(wi + d, COLW_MIN, COLW_MAX)
      next[i + 1] = clamp(wj - d, COLW_MIN, COLW_MAX)
      setColWidths(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.userSelect = 'none'
  }

  // Apply a Customize preset to the working layout (filtered to available cards);
  // the user then tweaks and saves. Replaces the whole arrangement + zone sizes.
  function applyWorkingPreset(p: TodayPreset) {
    const next = applyPreset(p, isAvailable)
    setFull(next.full)
    setLayout(next.cols)
    setHidden(next.hidden)
    setBandHeight(next.bandHeight)
    setColWidths(next.colWidths)
  }

  function cancel() {
    setEditing(false)
    setDrag(null)
    setFull(effectiveResolved.full)
    setLayout(effectiveResolved.cols)
    setHidden(effectiveResolved.hidden)
    setBandHeight(effectiveResolved.bandHeight)
    setColWidths(effectiveResolved.colWidths)
  }
  // Hide a card from Today: pull it out of the band + columns and remember it as
  // hidden, so it stays gone (and, for module cards, doesn't auto-reappear) until shown.
  function hideCard(card: string) {
    const next = removeCardEverywhere(workingRef.current, card)
    setFull(next.full)
    setLayout(next.cols)
    setHidden((prev) => (prev.includes(card) ? prev : [...prev, card]))
  }
  // Bring a hidden card back — drop it from `hidden` and append it to a column.
  function showCard(card: string) {
    setHidden((prev) => prev.filter((c) => c !== card))
    setLayout((prev) => appendToColumn(prev, card))
  }
  async function persist(scope: LayoutScope) {
    setSaving(true)
    try {
      await save(scope, {
        full,
        cols: layout,
        hidden,
        ...(bandHeight != null ? { bandHeight } : {}),
        ...(colWidths ? { colWidths } : {}),
      })
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

  // What to render: the working layout (editing) or the resolved layout (view),
  // or a just-dropped live layout while its PUT is in flight. The dragged card is
  // NOT removed — it renders in place as a dimmed source (see renderCard), which
  // keeps its DOM node mounted so a touch pointer's implicit capture isn't lost
  // (removing it fires pointercancel → the drag snaps back).
  const displayLayout: RegionLayout = editing
    ? { full, cols: layout }
    : liveOverride ?? { full: effectiveResolved.full, cols: effectiveResolved.cols }
  const curBandHeight = editing ? bandHeight : effectiveResolved.bandHeight
  const curColWidths = editing ? colWidths : effectiveResolved.colWidths
  // Show the band whenever it holds a card, or while dragging/editing so it's a drop zone.
  const showBand = displayLayout.full.length > 0 || !!drag || editing
  // Hidden cards the user could bring back — only those whose module is on.
  const hiddenShowable = hidden.filter((c) => CARDS[c] && isAvailable(c))

  // One card in a zone: the drop-line before it (when it's the target slot), then
  // the card. The dragged card keeps rendering (DOM stays mounted) but drops its
  // `data-card` so dropTargetAt skips it, and dims via `dragging-source`.
  function renderCard(card: string, region: Region, idx: number) {
    const def = CARDS[card]
    if (!def) return null
    const dragged = drag?.card === card
    return (
      <Fragment key={card}>
        {drag && target?.region === region && target?.index === idx && <div className="today-drop-line" />}
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
  function renderZoneTail(cards: string[], region: Region) {
    return (
      <>
        {drag && target?.region === region && target?.index === cards.length && <div className="today-drop-line" />}
        {(editing || !!drag) && cards.length === 0 && <div className="today-col-empty">Drop a card here</div>}
      </>
    )
  }

  return (
    <div className={`today-wrap ${editing ? 'today-editing' : ''} ${drag ? 'today-dragging' : ''}`}>
      <GettingStartedBar />
      {(showChores || rewardsEnabled(household)) && <ApprovalsBar />}
      {moduleEnabled(household, 'goals') && <GoalRecapBar />}

      {editing && (
        <div className="today-toolbar">
          <span className="tiny muted today-toolbar-hint">Drag cards to rearrange; drag the dividers to resize</span>
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

      {showBand && (
        <div className={`today-full ${curBandHeight ? 'today-full--fixed' : ''}`} data-region="full" style={{ '--band-h': curBandHeight ? `${curBandHeight}px` : 'auto' } as CSSProperties}>
          {displayLayout.full.map((card, idx) => renderCard(card, 'full', idx))}
          {renderZoneTail(displayLayout.full, 'full')}
        </div>
      )}
      {/* Horizontal divider (Customize only) — drag to resize the band vs the columns. */}
      {editing && showBand && (
        <div className="today-divider-h" onPointerDown={startBandResize} title="Drag to resize the calendar band">
          <span className="today-divider-grip" />
        </div>
      )}

      <div className={`today-board ${editing ? 'editing' : ''} ${drag ? 'dragging' : ''}`}>
        {displayLayout.cols.map((col, ci) => (
          <Fragment key={ci}>
            {/* Vertical dividers (Customize only) — drag to rebalance column widths. */}
            {editing && ci > 0 && (
              <div className="today-divider-v" onPointerDown={(e) => startColResize(e, ci - 1)} title="Drag to resize columns">
                <span className="today-divider-grip" />
              </div>
            )}
            <div className="today-col" data-region={ci} style={{ '--col-w': curColWidths?.[ci] ?? 1 } as CSSProperties}>
              {col.map((card, idx) => renderCard(card, ci, idx))}
              {renderZoneTail(col, ci)}
            </div>
          </Fragment>
        ))}
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
