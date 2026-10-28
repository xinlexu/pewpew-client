import { type BaseConfig, getBaseConfig } from 'tauri-plugin-mihomo-api'

import {
  detectProxyConflicts,
  findFreeProxyPort,
  getVergeConfig,
  patchClashConfig,
  patchVergeConfig,
} from '@/services/cmds'
import { PEWPEW_DEFAULT_MIXED_PORT } from '@/utils/pewpew-ports'

export type ProxyConflict = {
  // Other proxy clients that are running.
  apps: string[]
  // Configured proxy port the core could not open, or null when it is fine.
  busyPort: number | null
}

// Port the system proxy points at.
export const configuredMixedPort = (
  verge: Pick<IVergeConfig, 'verge_mixed_port'> | null | undefined,
  config: Pick<BaseConfig, 'mixedPort'> | null | undefined,
) => verge?.verge_mixed_port || config?.mixedPort || PEWPEW_DEFAULT_MIXED_PORT

// The core reports port 0 when another program already holds its proxy port.
export const isProxyPortOpen = (
  config: Pick<BaseConfig, 'mixedPort'> | null | undefined,
) => !!config?.mixedPort

export async function findProxyConflict(
  config: Pick<BaseConfig, 'mixedPort'>,
): Promise<ProxyConflict | null> {
  const [verge, report] = await Promise.all([
    getVergeConfig(),
    detectProxyConflicts().catch(() => ({ apps: [] as string[] })),
  ])
  const apps = report?.apps ?? []
  const busyPort = isProxyPortOpen(config)
    ? null
    : configuredMixedPort(verge, config)
  if (busyPort === null && apps.length === 0) return null
  return { apps, busyPort }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Moves the proxy to a free port and waits until the core listens there.
export async function switchProxyPort(busyPort: number) {
  const next = await findFreeProxyPort(busyPort)
  if (!next) throw new Error('pewpew-no-free-port')
  await patchClashConfig({ 'mixed-port': next })
  await patchVergeConfig({ verge_mixed_port: next })
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const config = await getBaseConfig().catch(() => null)
    if (config?.mixedPort === next) return next
    await wait(250)
  }
  throw new Error('pewpew-port-switch-unverified')
}
