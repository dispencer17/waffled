import { useEffect } from 'react'
import { useHousehold } from '../../lib/api'
import { applyEventStyle, eventStyle } from '../../lib/display'

// Stamps the household's event-style display setting onto the document root
// (data-ev-style) so pure CSS switches every event chip between solid (the
// default) and the softer tint wash. useHousehold refetches on the
// household-changed event, so a Settings flip restyles live. Renders nothing.
export function EventStyleSync() {
  const { household } = useHousehold()
  useEffect(() => {
    applyEventStyle(eventStyle(household))
  }, [household])
  return null
}
