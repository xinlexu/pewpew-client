export type ConnectionMode = 'standard' | 'enhanced'

export type ConnectionSettings = {
  enable_system_proxy?: boolean
  enable_tun_mode?: boolean
  pewpew_enhanced_mode?: boolean
  pewpew_enhanced_accepted?: boolean
}

export const connectionMode = (settings: ConnectionSettings): ConnectionMode =>
  (settings.pewpew_enhanced_mode ?? settings.enable_tun_mode ?? false)
    ? 'enhanced'
    : 'standard'

export const connectionPatch = (enabled: boolean, mode: ConnectionMode) => ({
  enable_system_proxy: enabled,
  enable_tun_mode: enabled && mode === 'enhanced',
})

export const connectionMatches = (
  expected: ReturnType<typeof connectionPatch>,
  actual: { systemProxy: boolean; tun: boolean },
) =>
  expected.enable_system_proxy === actual.systemProxy &&
  expected.enable_tun_mode === actual.tun

export function createConnectionQueue() {
  let pending: Promise<unknown> = Promise.resolve()
  return <T>(action: () => Promise<T>): Promise<T> => {
    const result = pending.then(action, action)
    pending = result.catch(() => {})
    return result
  }
}

export async function applyDisconnect(
  hadTun: boolean,
  apply: (settings: ConnectionSettings) => Promise<void>,
) {
  await apply({ enable_system_proxy: false })
  if (hadTun) await apply({ enable_tun_mode: false })
}

export async function applyConnectionChange(
  desired: ConnectionSettings,
  previous: ConnectionSettings,
  apply: (settings: ConnectionSettings) => Promise<void>,
  verify: (settings: ConnectionSettings) => Promise<void>,
) {
  try {
    await apply(desired)
    await verify(desired)
  } catch (error) {
    try {
      await apply(previous)
      await verify(previous)
    } catch {
      throw new Error('pewpew-connection-rollback-failed', { cause: error })
    }
    throw error
  }
}
