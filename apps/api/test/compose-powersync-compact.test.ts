// Self-hosted PowerSync never compacts its bucket storage on its own: every
// update appends ops and nothing collapses the superseded ones. Left alone the
// household bucket grew to 2.4M ops for ~1k live rows (2026-10 kiosk incident)
// and a fresh device could no longer finish its first sync. A sidecar runs the
// service's own `compact` command on a schedule, alongside the live service.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('PowerSync compaction sidecar', () => {
  it('runs `compact` on a schedule with the same image, config, and storage as powersync', async () => {
    const compose = await readFile(resolve(root, 'infra/compose/docker-compose.yml'), 'utf8')
    const block = compose.match(/\n {2}powersync-compact:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n|\n[a-z])/)?.[1]
    expect(block, 'powersync-compact service').toBeDefined()
    // Same pinned image as the service it maintains (bumped together).
    const psImage = compose.match(/\n {2}powersync:\n[\s\S]*?image: (\S+)/)?.[1]
    expect(block).toContain(`image: ${psImage}`)
    // The CLI's compact command, repeated forever on an interval.
    expect(block).toMatch(/entry\.js compact/)
    expect(block).toMatch(/while true/)
    expect(block).toMatch(/sleep/)
    // Same config + env as powersync (shared anchor), so it hits the same storage.
    expect(compose).toMatch(/\n {2}powersync:\n[\s\S]*?environment: &powersync-env/)
    expect(block).toMatch(/environment: \*powersync-env/)
    expect(block).toMatch(/\.\/powersync:\/config:ro/)
    expect(block).toMatch(/restart: unless-stopped/)
  })

  it('is stopped with the other app services during a restore', async () => {
    const script = await readFile(resolve(root, 'waffled'), 'utf8')
    expect(script).toMatch(/stop api powersync powersync-compact caddy/)
  })
})
