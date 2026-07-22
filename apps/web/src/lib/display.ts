// Household display settings — how event chips color across the calendar
// views. 'solid' (full person-color blocks — the default, maximum glanceable
// color) or 'tinted' (the softer wash). Stored in household.settings.display
// and stamped onto the document root as `data-ev-style` (theme.ts precedent)
// so styles/waffled.css can switch .ev-tint purely in CSS.
import type { Household } from './api/persons'

export type EventStyle = 'solid' | 'tinted'

/** Resolve the household's event style; anything but an explicit 'tinted' is solid. */
export function eventStyle(household: Household | null | undefined): EventStyle {
  const v = (household?.settings as { display?: { eventStyle?: unknown } } | undefined)?.display?.eventStyle
  return v === 'tinted' ? 'tinted' : 'solid'
}

/** Stamp the style onto <html data-ev-style> (always, so CSS keys stay simple). */
export function applyEventStyle(style: EventStyle): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-ev-style', style)
  }
}
