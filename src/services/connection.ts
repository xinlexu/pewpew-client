import { invoke } from '@tauri-apps/api/core'
import { closeAllConnections, getBaseConfig } from 'tauri-plugin-mihomo-api'

import {
  getRunningMode,
  getSystemProxy,
  getVergeConfig,
  patchVergeConfig,
} from '@/services/cmds'
import {
  type ConnectionMode,
  type ConnectionSettings,
  applyConnectionChange,
  applyDisconnect,
  connectionMatches,
  connectionMode,
  connectionPatch,
  createConnectionQueue,
} from '@/utils/connection-state'

const enqueue = createConnectionQueue()

export type ConnectionRequest = {
  enabled?: boolean
  mode?: ConnectionMode
  acceptEnhanced?: boolean
}

export async function readConnectionState() {
  const [settings, config, system, pac] = await Promise.all([
    getVergeConfig(),
    getBaseConfig().catch(() => null),
    getSystemProxy(),
    invoke<{ enable: boolean; url: string }>('get_auto_proxy'),
  ])
  const host = settings.proxy_host || '127.0.0.1'
  const port = settings.verge_mixed_port || config?.mixedPort || 7897
  const pacPort = import.meta.env.DEV ? 11233 : 33331
  const coreStopped = !config && (await getRunningMode()) === 'NotRunning'
  return {
    settings,
    config,
    coreStopped,
    systemProxy: Boolean(
      (system.enable && system.server === `${host}:${port}`) ||
        (pac.enable && pac.url === `http://${host}:${pacPort}/commands/pac`),
    ),
    tun: config?.tun?.enable ?? (!coreStopped && !!settings.enable_tun_mode),
  }
}

export const changeConnection = (request: ConnectionRequest) =>
  enqueue(async () => {
    const before = await readConnectionState()
    const mode = request.mode || connectionMode(before.settings)
    const enabled = request.enabled ?? (before.systemProxy || before.tun)
    const accepted =
      request.acceptEnhanced || before.settings.pewpew_enhanced_accepted

    if (request.enabled === false) {
      // Never re-enable a working proxy after a partial disconnect failure.
      await applyDisconnect(
        before.tun || !!before.settings.enable_tun_mode,
        patchVergeConfig,
      )
      const after = await readConnectionState()
      if (
        after.systemProxy ||
        after.tun ||
        (!after.config && !after.coreStopped)
      ) {
        throw new Error('pewpew-connection-verification-failed')
      }
      if (before.settings.auto_close_connection) {
        await closeAllConnections().catch(() => {})
      }
      return
    }
    if (mode === 'enhanced' && (enabled || request.mode) && !accepted) {
      throw new Error('pewpew-enhanced-consent-required')
    }

    if (!enabled) {
      await patchVergeConfig({
        pewpew_enhanced_mode: mode === 'enhanced',
        pewpew_enhanced_accepted: accepted ?? false,
      })
      return
    }
    if (!before.config) throw new Error('pewpew-core-unavailable')

    if (enabled && mode === 'enhanced') {
      await invoke('prepare_enhanced_connection')
    }

    const previous: ConnectionSettings = {
      enable_system_proxy: before.systemProxy,
      enable_tun_mode: before.tun,
      pewpew_enhanced_mode: connectionMode(before.settings) === 'enhanced',
      pewpew_enhanced_accepted:
        before.settings.pewpew_enhanced_accepted ?? false,
    }
    const desired = {
      ...connectionPatch(enabled, mode),
      pewpew_enhanced_mode: mode === 'enhanced',
      pewpew_enhanced_accepted: accepted ?? false,
    }
    await applyConnectionChange(
      desired,
      previous,
      patchVergeConfig,
      async (expected) => {
        const actual = await readConnectionState()
        if (
          (!actual.config && !actual.coreStopped) ||
          !connectionMatches(
            {
              enable_system_proxy: expected.enable_system_proxy ?? false,
              enable_tun_mode: expected.enable_tun_mode ?? false,
            },
            actual,
          )
        ) {
          throw new Error('pewpew-connection-verification-failed')
        }
      },
    )
  })
