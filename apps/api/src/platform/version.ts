// Build/version info surfaced on /healthz, /api/health and /api/version so an
// operator can see exactly which build is running. GIT_SHA + BUILD_TIME are baked
// into the image at docker build (Dockerfile ARG → ENV; the ./waffled CLI passes
// them), FORK_VERSION alongside them as `git describe --tags --always` — upstream
// base tag + commits ahead + sha (e.g. v0.8.0-150-gabc1234). All fall back to
// 'dev'/null for a from-source/local run. Env is read lazily (getters) so tests can
// set the vars before importing the app without fighting module-load order.
import pkg from '../../package.json'

export interface VersionInfo {
  pkg: string
  sha: string
  fork: string
  buildTime: string | null
}

export const version: VersionInfo = {
  pkg: (pkg as { version?: string }).version ?? '0.0.0',
  get sha() { return process.env.GIT_SHA || 'dev' },
  get fork() { return process.env.FORK_VERSION || 'dev' },
  get buildTime() { return process.env.BUILD_TIME || null },
}
