// Thin HTTP wrappers for a household's Home Assistant instance. Waffled is the
// caller (server-side proxy) so the long-lived access token never reaches a
// browser. Base URL + token are per-household settings, not deploy env — every
// call takes them as arguments. Kept fetch-thin like integrations/google.ts so
// tests can point baseUrl at an in-process stub.

const TIMEOUT_MS = 8_000

export interface HaEntityState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed?: string
}

export interface HaInstanceInfo {
  version?: string
  location_name?: string
}

export class HaError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function haUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

async function haFetch<T>(baseUrl: string, token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(haUrl(baseUrl, path), {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new HaError(`home assistant -> ${res.status}`, res.status)
  return (await res.json()) as T
}

/** GET /api/config — instance info; doubles as the connectivity/auth check. */
export function getHaInfo(baseUrl: string, token: string): Promise<HaInstanceInfo> {
  return haFetch<HaInstanceInfo>(baseUrl, token, '/api/config')
}

/** GET /api/states — every entity's current state. */
export function getHaStates(baseUrl: string, token: string): Promise<HaEntityState[]> {
  return haFetch<HaEntityState[]>(baseUrl, token, '/api/states')
}

/** POST /api/services/{domain}/{service} — perform an action (e.g. light.turn_off). */
export async function callHaService(
  baseUrl: string,
  token: string,
  domain: string,
  service: string,
  data: Record<string, unknown>
): Promise<void> {
  await haFetch(baseUrl, token, `/api/services/${domain}/${service}`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
