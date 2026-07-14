// Smart Home (Home Assistant) domain — quick-controls states + admin config.
// Everything proxies through the Waffled API (/api/homeassistant/*) so the HA
// token never reaches the browser; entities here are only the admin-pinned set.
import { apiGet, apiSend } from './client'

export interface HaStatus {
  configured: boolean
  connected?: boolean
  locationName?: string
  version?: string
  error?: string
  entities: string[]
}

export interface HaEntity {
  entityId: string
  name: string
  domain: string
  state: string
}

export interface HaConfig {
  baseUrl: string | null
  hasToken: boolean
  entities: string[]
}

export const homeAssistantApi = {
  status: () => apiGet<HaStatus>('/api/homeassistant/status'),
  config: () => apiGet<HaConfig>('/api/homeassistant/config'),
  saveConfig: (patch: { baseUrl?: string; token?: string; entities?: string[] }) =>
    apiSend<HaStatus>('PUT', '/api/homeassistant/config', patch),
  entities: () => apiGet<{ entities: HaEntity[] }>('/api/homeassistant/entities'),
  allEntities: () => apiGet<{ entities: HaEntity[] }>('/api/homeassistant/entities/all'),
  callService: (domain: string, service: string, entityId: string, data?: Record<string, unknown>) =>
    apiSend<{ ok: boolean }>('POST', '/api/homeassistant/service', { domain, service, entityId, data }),
}

// The service that "activates" an entity, per domain. Toggleables toggle; one-shot
// domains (scene/script/button) fire their turn_on/press. Anything else is
// display-only on the card.
export function actionFor(e: HaEntity): { domain: string; service: string } | null {
  switch (e.domain) {
    case 'light':
    case 'switch':
    case 'fan':
    case 'input_boolean':
      return { domain: e.domain, service: 'toggle' }
    case 'scene':
    case 'script':
      return { domain: e.domain, service: 'turn_on' }
    case 'button':
    case 'input_button':
      return { domain: e.domain, service: 'press' }
    case 'lock':
      // Deliberately no tap action for locks — show state only.
      return null
    default:
      return null
  }
}

export function isOn(e: HaEntity): boolean {
  return e.state === 'on'
}
