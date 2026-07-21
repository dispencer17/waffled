// In-app update notifier — admin-only. Mirrors apps/api/src/modules/updates/updates.ts.
import { apiGet, apiSend } from './client'

export interface UpdateInfo {
  enabled: boolean
  reason?: string
  current: { version: string; sha: string; fork: string }
  latest?: { tag: string; url: string; publishedAt: string | null } | null
  updateAvailable?: boolean
  checkedAt?: string
  error?: string
}

// Build provenance for the About panel — every member (not admin-gated).
// `fork` is `git describe` at image build: upstream base + commits ahead + sha.
export interface BuildVersion {
  pkg: string
  sha: string
  fork: string
  buildTime: string | null
}

export const updatesApi = {
  get: () => apiGet<UpdateInfo>('/api/updates'),
  setEnabled: (enabled: boolean) => apiSend<{ enabled: boolean }>('PUT', '/api/updates/settings', { enabled }),
}

export const versionApi = {
  get: () => apiGet<BuildVersion>('/api/version'),
}
