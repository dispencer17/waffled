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

// A drop region: the full-width band, or a column by index.
export type Region = 'full' | number
// The card arrangement across the two zone kinds: the full-width band + columns.
export interface RegionLayout {
  full: string[]
  cols: string[][]
}

// Drop a card from the band and from every column (a card lives in one place).
export function removeCardEverywhere(layout: RegionLayout, card: string): RegionLayout {
  return {
    full: layout.full.filter((c) => c !== card),
    cols: layout.cols.map((col) => col.filter((c) => c !== card)),
  }
}

// Move a card to (region, index). Indices are relative to the layout WITHOUT the
// card (the board renders the dragged card as a no-`data-card` placeholder, so
// dropTargetAt's indices map straight in). 'full' targets the band; a number
// targets that column, out-of-range falling back to the last.
export function insertAtRegion(layout: RegionLayout, card: string, region: Region, index: number): RegionLayout {
  const base = removeCardEverywhere(layout, card)
  const full = [...base.full]
  const cols = base.cols.map((c) => [...c])
  if (region === 'full') full.splice(index, 0, card)
  else (cols[region] ?? cols[cols.length - 1]).splice(index, 0, card)
  return { full, cols }
}

// Which region ('full' or a column index) + insertion index is under the pointer,
// read from the live DOM (zones carry data-region, cards data-card). The dragged
// card renders as a placeholder with no data-card, so it's skipped and indices map
// straight into its would-be position. Band + columns both stack their cards, so
// the y-midpoint test works for either.
export function dropTargetAt(x: number, y: number): { region: Region; index: number } | null {
  const el = document.elementFromPoint(x, y)
  const regionEl = el && (el as Element).closest('[data-region]')
  if (!regionEl) return null
  const raw = regionEl.getAttribute('data-region')
  const region: Region = raw === 'full' ? 'full' : Number(raw)
  const cards = [...regionEl.querySelectorAll('[data-card]')]
  let index = cards.length
  for (let k = 0; k < cards.length; k++) {
    const r = cards[k].getBoundingClientRect()
    if (y < r.top + r.height / 2) {
      index = k
      break
    }
  }
  return { region, index }
}
