// Smart Home (Home Assistant) — shared shapes. Config lives in
// households.settings.homeAssistant; the token is AES-encrypted at rest and
// never leaves the server.

export interface HaStoredSettings {
  baseUrl?: string
  tokenEncrypted?: string
  // Pinned entity allowlist — the ONLY entities quick-controls and voice may
  // read or act on. Admins curate it in Settings.
  entities?: string[]
}

export interface HaStatusDto {
  // Base URL + token are saved and the encryption key is available.
  configured: boolean
  // Set when configured: did a live GET /api/config succeed just now?
  connected?: boolean
  locationName?: string
  version?: string
  error?: string
  entities: string[]
}

export interface HaEntityDto {
  entityId: string
  // Friendly name when HA has one, else the entity id.
  name: string
  domain: string
  state: string
}
