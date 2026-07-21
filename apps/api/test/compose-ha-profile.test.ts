// The optional Home Assistant service must stay opt-in (profile-gated) so a
// plain `./waffled up` never pays its resource cost — but be one command away
// once the household's device brands are known.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('Home Assistant compose profile', () => {
  it('ships an opt-in homeassistant service with a durable config volume', async () => {
    const compose = await readFile(resolve(root, 'infra/compose/docker-compose.yml'), 'utf8')
    // Profile-gated — never part of the default stack.
    expect(compose).toMatch(/homeassistant:[\s\S]{0,400}profiles: \["homeassistant"\]/)
    expect(compose).toContain('ghcr.io/home-assistant/home-assistant:stable')
    // Config survives recreates, port serves the LAN, and it restarts with the box.
    expect(compose).toMatch(/ha_config:\/config/)
    expect(compose).toMatch(/homeassistant:[\s\S]{0,700}"8123:8123"/)
    expect(compose).toMatch(/homeassistant:[\s\S]{0,700}restart: unless-stopped/)
    // The named volume is declared at the top level.
    expect(compose).toMatch(/^volumes:[\s\S]*?\n {2}ha_config:/m)
  })
})
