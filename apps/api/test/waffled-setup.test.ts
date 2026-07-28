// `./waffled setup` writes the address settings. Its localhost branch must NOT
// pin POWERSYNC_PUBLIC_URL to localhost: the api now derives a reachable sync URL
// per request, so leaving it empty works for BOTH this computer and any tablet or
// phone that later opens the kiosk. Pinning localhost silently breaks realtime
// sync on every other device (they resolve localhost to themselves).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../../..', 'waffled')
const cliSource = readFileSync(cli, 'utf8')
const setupCase = cliSource.slice(cliSource.indexOf('  setup)'), cliSource.indexOf('  doctor)'))

describe('waffled setup — sync address', () => {
  it('never pins POWERSYNC_PUBLIC_URL to localhost', () => {
    expect(setupCase).not.toMatch(/set_env_var POWERSYNC_PUBLIC_URL "http:\/\/localhost/)
  })

  it('clears POWERSYNC_PUBLIC_URL for the localhost choice so the api derives it', () => {
    const localhostBranch = setupCase.slice(setupCase.indexOf('      1)'), setupCase.indexOf('      2)'))
    expect(localhostBranch).toMatch(/set_env_var POWERSYNC_PUBLIC_URL ""/)
  })

  it('still pins an explicit URL for the LAN-IP and hostname choices', () => {
    const rest = setupCase.slice(setupCase.indexOf('      2)'))
    expect(rest).toMatch(/set_env_var POWERSYNC_PUBLIC_URL "http:\/\/\$addr:\$ps_port"/)
    expect(rest).toMatch(/set_env_var POWERSYNC_PUBLIC_URL "https:\/\/\$host:\$ps_port"/)
  })
})
