// fork — Per-slot channel between the Today board and its cards. The board
// wraps every card in a CardSlotCtx provider; cards report their emptiness
// (for the hide-empty-cards board option) and read their per-card quiet
// settings without ever knowing their own card key. Cards rendered outside
// Today (e.g. PantryCard on the Pantry page) see a null context and both
// hooks become no-ops.
import { createContext, useContext, useEffect } from 'react'
import type { BoardOptions } from '../lib/api/today-layout'

type CardOptionsMap = NonNullable<BoardOptions['cards']>

export interface CardSlotApi {
  /** Report whether the card currently has nothing to show. */
  reportEmpty: (empty: boolean) => void
  /** This card's quiet settings (options.cards[key]), if any. */
  cardOptions?: CardOptionsMap[keyof CardOptionsMap]
}

export const CardSlotCtx = createContext<CardSlotApi | null>(null)

/**
 * Cards call this every render: `undefined` while still loading (no report —
 * the slot stays visible, so the board never flicker-collapses), then the
 * computed emptiness once data resolves. Errors should report `false` — an
 * error message is content the user needs to see.
 */
export function useCardEmpty(isEmpty: boolean | undefined): void {
  const ctx = useContext(CardSlotCtx)
  useEffect(() => {
    if (ctx && isEmpty !== undefined) ctx.reportEmpty(isEmpty)
  }, [ctx, isEmpty])
}

/** The card's quiet settings from the board options, typed by the caller. */
export function useCardOptions<T extends CardOptionsMap[keyof CardOptionsMap]>(): T | undefined {
  const ctx = useContext(CardSlotCtx)
  return ctx?.cardOptions as T | undefined
}
