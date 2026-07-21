import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { AgendaCard } from './components/AgendaCard'
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
import { removeCard, appendToColumn, applyModuleCard, hideModuleCard, insertAt, dropTargetAt } from './today-layout-utils'

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
}

// Pure layout helpers + drop-target math live in today-layout-utils.ts (tested).

// Live drag: how long a press must hold still to lift a card, and how far the
// pointer may wander during the hold before we treat the gesture as a scroll.
const HOLD_MS = 450
const HOLD_SLOP = 8

// The kiosk "Today" dashboard. Cards are arranged from a saved layout (family
// default + optional per-person override) and can be rearranged in a Customize
// mode via drag-and-drop, then saved for just you or the whole family.
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
    return { cols, hidden }
  }, [resolved, showPantry, showFamilyNight, showGoals, showChores, showMeals, showGrocery, showSmartHome])
  const [editing, setEditing] = useState(false)
  const [layout, setLayout] = useState<string[][]>(effectiveResolved.cols)
  const [hidden, setHidden] = useState<string[]>(effectiveResolved.hidden)
  const [saving, setSaving] = useState(false)

  // Pointer drag state (Customize chips AND live long-press drags). `drag` is
  // set once per drag so the listener effect subscribes once; `pos` drives the
  // ghost, `target` the drop indicator (read live via ref on drop). A live drag
  // (`live: true`) starts from a long-press on the board and auto-saves on drop.
  const [drag, setDrag] = useState<{ card: string; live?: boolean } | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [target, setTarget] = useState<{ col: number; index: number } | null>(null)
  const targetRef = useRef<{ col: number; index: number } | null>(null)
  targetRef.current = target
  // While a live drop's PUT is in flight, render its layout (covers the gap
  // until the hook's optimistic update lands); reverts on failure. Refs keep
  // the drag effect subscribed once per drag without stale closures.
  const [liveCols, setLiveCols] = useState<string[][] | null>(null)
  const resolvedRef = useRef(effectiveResolved)
  resolvedRef.current = effectiveResolved
  const saveRef = useRef(save)
  saveRef.current = save

  // Keep the working copy in sync with the server layout (+ module cards) when not editing.
  useEffect(() => {
    if (!editing) {
      setLayout(effectiveResolved.cols)
      setHidden(effectiveResolved.hidden)
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
          const next = insertAt(base.cols, drag.card, t.col, t.index)
          setLiveCols(next)
          saveRef
            .current('user', { cols: next, hidden: base.hidden })
            .catch(() => {}) // clearing liveCols below reverts to the server layout
            .finally(() => setLiveCols(null))
        } else {
          setLayout((prev) => insertAt(prev, drag.card, t.col, t.index))
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

  function cancel() {
    setEditing(false)
    setDrag(null)
    setLayout(effectiveResolved.cols)
    setHidden(effectiveResolved.hidden)
  }
  // Hide a card from Today: pull it out of the columns and remember it as hidden,
  // so it stays gone (and, for module cards, doesn't auto-reappear) until shown.
  function hideCard(card: string) {
    setLayout((prev) => removeCard(prev, card))
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
      await save(scope, { cols: layout, hidden })
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

  // During a drag, render the layout without the dragged card so the drop
  // indicator and indices line up; otherwise render the working/resolved layout
  // (or a just-dropped live layout while its PUT is in flight).
  const cols = editing ? layout : (liveCols ?? effectiveResolved.cols)
  const display = drag ? removeCard(cols, drag.card) : cols
  // Hidden cards the user could bring back — only those whose module is on (a card
  // whose module is off can't be shown, and would just get stripped again).
  const hiddenShowable = hidden.filter((c) => CARDS[c] && isAvailable(c))

  return (
    <div className={`today-wrap ${editing ? 'today-editing' : ''}`}>
      <GettingStartedBar />
      {(showChores || rewardsEnabled(household)) && <ApprovalsBar />}
      {moduleEnabled(household, 'goals') && <GoalRecapBar />}

      {editing && (
        <div className="today-toolbar">
          <span className="tiny muted today-toolbar-hint">Drag a card by its bar to rearrange</span>
          <button type="button" className="pill" style={{ cursor: 'pointer' }} disabled={saving} onClick={cancel}>Cancel</button>
          <button type="button" className="pill" style={{ cursor: 'pointer' }} disabled={saving} onClick={resetDefault}>Reset to defaults</button>
          <button type="button" className="pill btn-primary" style={{ color: 'var(--on-accent)', border: 0, cursor: 'pointer' }} disabled={saving} onClick={() => persist('user')}>Save for me</button>
        </div>
      )}

      <div className={`today-board ${editing ? 'editing' : ''} ${drag ? 'dragging' : ''}`}>
        {display.map((col, ci) => (
          <div className="today-col" data-col={ci} key={ci}>
            {col.map((card, idx) => {
              const def = CARDS[card]
              if (!def) return null
              return (
                <Fragment key={card}>
                  {drag && target?.col === ci && target?.index === idx && <div className="today-drop-line" />}
                  {editing ? (
                    // In edit mode cards collapse to a compact chip (just the labeled drag
                    // bar) so a long list — a 60-item grocery card — can't dominate the board
                    // and bury the cards below it.
                    <div className="today-card-wrap compact" data-card={card}>
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
                    <div className={`today-slot ${def.fill ? 'fill' : ''}`} data-card={card} onPointerDown={(e) => beginHold(e, card)}>
                      {def.node}
                    </div>
                  )}
                </Fragment>
              )
            })}
            {drag && target?.col === ci && target?.index === col.length && <div className="today-drop-line" />}
            {(editing || !!drag) && col.length === 0 && <div className="today-col-empty">Drop a card here</div>}
          </div>
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
