// Smart Home (Home Assistant) — service layer. Waffled proxies every call so
// the HA long-lived token stays server-side (encrypted at rest via
// platform/crypto.ts, same path as Google refresh tokens). The entity
// allowlist is a real guardrail: quick-controls (and later voice) can only
// touch entities an admin pinned in Settings.
import { query } from '../../platform/db'
import { encryptSecret, decryptSecret, encryptionAvailable } from '../../platform/crypto'
import { getHaInfo, getHaStates, callHaService, HaError } from '../../integrations/home-assistant'
import type { HaStoredSettings, HaStatusDto, HaEntityDto } from './homeassistant.types'

const ID_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/ // domain.object_id
const NAME_RE = /^[a-z0-9_]+$/ // service/domain names

export async function getSettings(householdId: string): Promise<HaStoredSettings> {
  const { rows } = await query<{ settings: { homeAssistant?: HaStoredSettings } | null }>(
    `select settings from households where id = $1`,
    [householdId]
  )
  const s = rows[0]?.settings?.homeAssistant ?? {}
  return {
    baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : undefined,
    tokenEncrypted: typeof s.tokenEncrypted === 'string' ? s.tokenEncrypted : undefined,
    entities: Array.isArray(s.entities) ? s.entities.filter((e) => typeof e === 'string' && ID_RE.test(e)) : [],
  }
}

export interface SetConfigInput {
  baseUrl?: string
  token?: string // plaintext, accepted once; stored encrypted, never returned
  entities?: string[]
}

export async function setConfig(householdId: string, input: SetConfigInput): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.baseUrl !== undefined) {
    const url = input.baseUrl.trim().replace(/\/+$/, '')
    if (url && !/^https?:\/\//.test(url)) throw new Error('baseUrl must start with http:// or https://')
    patch.baseUrl = url || null
  }
  if (input.token !== undefined && input.token.trim()) {
    if (!encryptionAvailable()) throw new Error('TOKEN_ENCRYPTION_KEY is not configured')
    patch.tokenEncrypted = encryptSecret(input.token.trim())
  }
  if (input.entities !== undefined) {
    patch.entities = input.entities.filter((e) => typeof e === 'string' && ID_RE.test(e))
  }
  if (!Object.keys(patch).length) return
  await query(
    `update households
        set settings = coalesce(settings, '{}'::jsonb)
                       || jsonb_build_object('homeAssistant', coalesce(settings->'homeAssistant', '{}'::jsonb) || $2::jsonb)
      where id = $1`,
    [householdId, JSON.stringify(patch)]
  )
}

// Resolve saved config into a live connection tuple, or null when unconfigured.
async function connection(householdId: string): Promise<{ baseUrl: string; token: string; entities: string[] } | null> {
  const s = await getSettings(householdId)
  if (!s.baseUrl || !s.tokenEncrypted || !encryptionAvailable()) return null
  return { baseUrl: s.baseUrl, token: decryptSecret(s.tokenEncrypted), entities: s.entities ?? [] }
}

export async function status(householdId: string): Promise<HaStatusDto> {
  const conn = await connection(householdId)
  if (!conn) return { configured: false, entities: [] }
  try {
    const info = await getHaInfo(conn.baseUrl, conn.token)
    return {
      configured: true,
      connected: true,
      locationName: info.location_name,
      version: info.version,
      entities: conn.entities,
    }
  } catch (err) {
    const msg = err instanceof HaError && err.status === 401 ? 'unauthorized — check the token' : 'unreachable'
    return { configured: true, connected: false, error: msg, entities: conn.entities }
  }
}

function toDto(s: { entity_id: string; state: string; attributes: Record<string, unknown> }): HaEntityDto {
  const friendly = s.attributes['friendly_name']
  return {
    entityId: s.entity_id,
    name: typeof friendly === 'string' && friendly ? friendly : s.entity_id,
    domain: s.entity_id.split('.')[0],
    state: s.state,
  }
}

/** States for the pinned entities only — what quick-controls renders. */
export async function listEntities(householdId: string): Promise<HaEntityDto[]> {
  const conn = await connection(householdId)
  if (!conn || !conn.entities.length) return []
  const pinned = new Set(conn.entities)
  const states = await getHaStates(conn.baseUrl, conn.token)
  const byId = new Map(states.filter((s) => pinned.has(s.entity_id)).map((s) => [s.entity_id, s]))
  // Preserve the admin's pin order; drop pins HA no longer knows.
  return conn.entities.filter((e) => byId.has(e)).map((e) => toDto(byId.get(e)!))
}

/** Every entity HA knows — admin-only discovery for the Settings picker. */
export async function listAllEntities(householdId: string): Promise<HaEntityDto[]> {
  const conn = await connection(householdId)
  if (!conn) return []
  const states = await getHaStates(conn.baseUrl, conn.token)
  return states.map(toDto).sort((a, b) => a.name.localeCompare(b.name))
}

export class NotAllowedError extends Error {}
export class BadInputError extends Error {}

/** Perform a service call on a PINNED entity (403 for anything unpinned). */
export async function callService(
  householdId: string,
  domain: string,
  service: string,
  entityId: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!NAME_RE.test(domain) || !NAME_RE.test(service)) throw new BadInputError('invalid domain/service')
  if (!ID_RE.test(entityId)) throw new BadInputError('invalid entity id')
  const conn = await connection(householdId)
  if (!conn) throw new Error('home assistant is not configured')
  if (!conn.entities.includes(entityId)) throw new NotAllowedError(`entity ${entityId} is not pinned`)
  await callHaService(conn.baseUrl, conn.token, domain, service, { ...(data ?? {}), entity_id: entityId })
}
