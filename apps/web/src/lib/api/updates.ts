// In-app update notifier — admin-only. Mirrors apps/api/src/modules/updates/updates.ts.
import { apiGet, apiSend } from './client'

// fork: deploy state for the in-app Update button. Reported by the host update
// agent — the API cannot see git from inside its container, so `behindCount` and
// agent liveness can only come from the machine that actually holds the repo.
export interface DeployState {
  status: 'idle' | 'queued' | 'running' | 'failed'
  behindCount: number
  message: string | null
  agentDown: boolean
  stuck: boolean
}

export interface UpdateInfo {
  enabled: boolean
  reason?: string
  current: { version: string; sha: string; fork: string }
  latest?: { tag: string; url: string; publishedAt: string | null } | null
  updateAvailable?: boolean
  checkedAt?: string
  error?: string
  // Present even when `enabled` is false: the switches above suppress the
  // outbound GitHub check, not the ability to deploy local commits. Optional
  // only because a page can briefly outlive the API build that served it during
  // a rebuild — treat absence as "idle, nothing known".
  update?: DeployState
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
  // fork: queue a deploy of the fork's latest main. Idempotent server-side.
  requestUpdate: () => apiSend<{ update: DeployState }>('POST', '/api/updates/request'),
}

export const versionApi = {
  get: () => apiGet<BuildVersion>('/api/version'),
}
