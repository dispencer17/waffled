// Pure layout helpers for the Today board (shared by Customize mode and live
// drag). A card lives in exactly one column.

export function removeCard(layout: string[][], card: string): string[][] {
  return layout.map((col) => col.filter((c) => c !== card))
}

// Append a card to the shortest column (or a preferred one).
export function appendToColumn(layout: string[][], card: string, preferCol?: number): string[][] {
  const cols = layout.map((c) => [...c])
  let target = preferCol != null && preferCol >= 0 && preferCol < cols.length ? preferCol : 0
  if (preferCol == null) for (let i = 1; i < cols.length; i++) if (cols[i].length < cols[target].length) target = i
  cols[target] = [...cols[target], card]
  return cols
}

// Reconcile an optional module's card with the saved layout: drop it when the
// module is off or the user hid it; inject it (into a preferred/shortest column)
// when it's on, not hidden, and not already placed. Preserves a user-placed
// position once saved. `hidden` wins — a card the user explicitly hid never
// auto-reappears just because its module is on.
export function applyModuleCard(layout: string[][], card: string, show: boolean, hidden: string[], preferCol?: number): string[][] {
  const present = layout.some((col) => col.includes(card))
  if (hidden.includes(card)) return present ? removeCard(layout, card) : layout
  if (show && !present) return appendToColumn(layout, card, preferCol)
  if (!show && present) return removeCard(layout, card)
  return layout
}

// For cards that ship in the default layout (chores/meals/grocery): strip them
// when their module is off, but never inject — so a user who removed the card in
// Customize keeps it removed while the module is on. (Pantry, which isn't in the
// default layout, uses applyModuleCard to appear when enabled.)
export function hideModuleCard(layout: string[][], card: string, show: boolean): string[][] {
  return show ? layout : removeCard(layout, card)
}

// Move a card to (col, index). Indices are relative to the layout WITHOUT the
// card (the board renders drags that way, so dropTargetAt's indices map
// straight in). An out-of-range column falls back to the last one.
export function insertAt(layout: string[][], card: string, col: number, index: number): string[][] {
  const base = removeCard(layout, card).map((c) => [...c])
  ;(base[col] ?? base[base.length - 1]).splice(index, 0, card)
  return base
}

// Which column + insertion index is under the pointer, read from the live DOM
// (columns carry data-col, cards data-card). The dragged card isn't rendered
// during a drag, so indices map straight into the card's would-be position.
export function dropTargetAt(x: number, y: number): { col: number; index: number } | null {
  const el = document.elementFromPoint(x, y)
  const colEl = el && (el as Element).closest('[data-col]')
  if (!colEl) return null
  const col = Number(colEl.getAttribute('data-col'))
  const cards = [...colEl.querySelectorAll('[data-card]')]
  let index = cards.length
  for (let k = 0; k < cards.length; k++) {
    const r = cards[k].getBoundingClientRect()
    if (y < r.top + r.height / 2) {
      index = k
      break
    }
  }
  return { col, index }
}
