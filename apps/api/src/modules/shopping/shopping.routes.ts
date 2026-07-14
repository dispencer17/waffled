// Walmart cart handoff (fork) — HTTP routes (/api/shopping/walmart). Logic in
// shopping.service.ts. Rides the `lists` module gate (it's a grocery feature).
import createAPI, { type Request, type Response } from 'lambda-api'
import { moduleRoutes } from '../../platform/route-guards'
import { walmartConfigured } from '../../integrations/walmart'
import { matchGroceryList, confirmMatch, shoppingStatus } from './shopping.service'

type Api = ReturnType<typeof createAPI>

const { tenantRoute } = moduleRoutes('lists')

export function registerShoppingRoutes(api: Api): void {
  // Is the affiliate API configured? Drives showing the "Send to Walmart" button.
  api.get('/api/shopping/walmart/status', tenantRoute(async () => shoppingStatus()))

  // Match every unchecked grocery item → products + the add-to-cart deep link.
  api.post('/api/shopping/walmart/match', tenantRoute(async (tenant, _req: Request, res: Response) => {
    if (!walmartConfigured()) {
      return res.status(501).json({
        error: 'NotConfigured',
        message: 'Walmart affiliate API is not configured (set WALMART_CONSUMER_ID and WALMART_PRIVATE_KEY)',
      })
    }
    return matchGroceryList(tenant)
  }))

  // Pin "that's the right product" so the match survives cache staleness.
  api.post('/api/shopping/walmart/confirm', tenantRoute(async (tenant, req: Request, res: Response) => {
    const body = (req.body ?? {}) as { itemName?: unknown; walmartItemId?: unknown }
    if (typeof body.itemName !== 'string' || typeof body.walmartItemId !== 'string') {
      return res.status(400).json({ error: 'BadRequest', message: 'itemName and walmartItemId are required' })
    }
    const ok = await confirmMatch(tenant.householdId, body.itemName, body.walmartItemId)
    if (!ok) return res.status(404).json({ error: 'NotFound', message: 'no cached match for that item' })
    return { ok: true }
  }))
}
