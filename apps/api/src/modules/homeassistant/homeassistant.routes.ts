// Smart Home (Home Assistant) — HTTP routes (/api/homeassistant). Logic in
// homeassistant.service.ts. Every route is gated by the optional `smartHome`
// module (403 when off).
import createAPI, { type Request, type Response } from 'lambda-api'
import { moduleRoutes } from '../../platform/route-guards'
import { getSettings, setConfig, status, listEntities, listAllEntities, callService, NotAllowedError, BadInputError } from './homeassistant.service'

type Api = ReturnType<typeof createAPI>

const { tenantRoute, adminRoute } = moduleRoutes('smartHome')

export function registerHomeAssistantRoutes(api: Api): void {
  // Configured/connected summary + the pinned allowlist. Any member.
  api.get('/api/homeassistant/status', tenantRoute(async (tenant) => {
    return status(tenant.householdId)
  }))

  // Save base URL / token / pinned entities. Token is write-only (never echoed).
  api.put('/api/homeassistant/config', adminRoute(async (tenant, req: Request, res: Response) => {
    const body = (req.body ?? {}) as { baseUrl?: unknown; token?: unknown; entities?: unknown }
    try {
      await setConfig(tenant.householdId, {
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        token: typeof body.token === 'string' ? body.token : undefined,
        entities: Array.isArray(body.entities) ? body.entities.filter((e): e is string => typeof e === 'string') : undefined,
      })
    } catch (err) {
      return res.status(400).json({ error: 'BadRequest', message: (err as Error).message })
    }
    return status(tenant.householdId)
  }))

  // States for the pinned entities — what quick-controls renders. Any member.
  api.get('/api/homeassistant/entities', tenantRoute(async (tenant, _req: Request, res: Response) => {
    try {
      return { entities: await listEntities(tenant.householdId) }
    } catch {
      return res.status(502).json({ error: 'BadGateway', message: 'home assistant unreachable' })
    }
  }))

  // Full entity list for the Settings picker. Admin-only discovery.
  api.get('/api/homeassistant/entities/all', adminRoute(async (tenant, _req: Request, res: Response) => {
    try {
      return { entities: await listAllEntities(tenant.householdId) }
    } catch {
      return res.status(502).json({ error: 'BadGateway', message: 'home assistant unreachable' })
    }
  }))

  // Perform an action on a pinned entity, e.g. {domain:'light', service:'toggle',
  // entityId:'light.kitchen'}. Any member — the allowlist is the guardrail.
  api.post('/api/homeassistant/service', tenantRoute(async (tenant, req: Request, res: Response) => {
    const body = (req.body ?? {}) as { domain?: unknown; service?: unknown; entityId?: unknown; data?: unknown }
    if (typeof body.domain !== 'string' || typeof body.service !== 'string' || typeof body.entityId !== 'string') {
      return res.status(400).json({ error: 'BadRequest', message: 'domain, service and entityId are required' })
    }
    try {
      await callService(
        tenant.householdId,
        body.domain,
        body.service,
        body.entityId,
        body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : undefined
      )
    } catch (err) {
      if (err instanceof NotAllowedError) {
        return res.status(403).json({ error: 'Forbidden', message: 'entity is not pinned for quick controls' })
      }
      if (err instanceof BadInputError) {
        return res.status(400).json({ error: 'BadRequest', message: err.message })
      }
      return res.status(502).json({ error: 'BadGateway', message: (err as Error).message })
    }
    return { ok: true }
  }))

  // Bare stored config (no live probe, no token) — handy for the Settings panel.
  api.get('/api/homeassistant/config', adminRoute(async (tenant) => {
    const s = await getSettings(tenant.householdId)
    return { baseUrl: s.baseUrl ?? null, hasToken: !!s.tokenEncrypted, entities: s.entities ?? [] }
  }))
}
