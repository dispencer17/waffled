// Voice → Home Assistant action mapping. Which service a spoken verb runs on
// which entity domain; null = not voice-controllable (locks stay hands-on).

export function actionForDomain(
  domain: string,
  wanted: 'turn_on' | 'turn_off' | 'toggle'
): { domain: string; service: string } | null {
  switch (domain) {
    case 'light':
    case 'switch':
    case 'fan':
    case 'input_boolean':
      return { domain, service: wanted }
    case 'scene':
    case 'script':
      return { domain, service: 'turn_on' } // scenes/scripts only ever fire
    case 'button':
    case 'input_button':
      return { domain, service: 'press' }
    default:
      return null
  }
}
