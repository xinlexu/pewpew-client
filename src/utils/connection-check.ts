// Same rule as route-health's isUsableDelay; kept local so this module has no
// runtime imports and the unit tests can load it directly.
const isUsableDelay = (delay: number | null | undefined): delay is number =>
  typeof delay === 'number' &&
  Number.isFinite(delay) &&
  delay > 0 &&
  delay < 10000

// Sites the connection check opens through the local proxy. The domestic one
// is normally routed direct, the foreign one through the route.
export const DOMESTIC_TEST_URL = 'https://www.baidu.com'
export const FOREIGN_TEST_URL = 'https://www.google.com'

// A full proxied HTTPS handshake to a domestic site normally takes well under
// half a second; to a foreign site through a route, about one second.
export const DOMESTIC_SLOW_MS = 1500
export const FOREIGN_SLOW_MS = 3000

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'off' | 'unknown'

// Status of one timed check; null means it did not run.
export const timedStatus = (
  ms: number | null | undefined,
  slowMs: number,
): CheckStatus => {
  if (ms === null || ms === undefined) return 'unknown'
  if (!isUsableDelay(ms)) return 'fail'
  return ms > slowMs ? 'warn' : 'ok'
}

export type CheckFacts = {
  // The client is set to be connected (system proxy or enhanced mode on).
  connected: boolean
  mode: 'standard' | 'enhanced'
  clashMode: string
  core: boolean
  portOpen: boolean
  systemProxy: boolean
  tun: boolean
  otherApps: string[] | null
  route: string | null
  // Milliseconds; null when the check did not run.
  routeDelay: number | null
  domestic: number | null
  foreign: number | null
}

export type CheckAction = 'repair' | 'fastestRoute' | 'smartMode' | null

export type VerdictKey =
  | 'coreDown'
  | 'disconnected'
  | 'portBusy'
  | 'enhancedMissing'
  | 'systemProxyOff'
  | 'directMode'
  | 'routeDown'
  | 'foreignDown'
  | 'foreignDownApps'
  | 'domesticSlowGlobal'
  | 'domesticSlowApps'
  | 'domesticSlow'
  | 'domesticDown'
  | 'otherApps'
  | 'foreignSlow'
  | 'okGlobal'
  | 'ok'
  | 'okPartial'

export type CheckVerdict = {
  tone: 'success' | 'info' | 'warning' | 'error'
  // Key under home.pewpew.check.verdict
  key: VerdictKey
  params?: Record<string, string | number>
  action: CheckAction
}

const verdict = (
  tone: CheckVerdict['tone'],
  key: VerdictKey,
  action: CheckAction = null,
  params?: CheckVerdict['params'],
): CheckVerdict => ({ tone, key, action, params })

// One conclusion for the whole check: the first broken link from the computer
// to the website, with the one action most likely to fix it.
export const judgeConnection = (facts: CheckFacts): CheckVerdict => {
  if (!facts.core) return verdict('error', 'coreDown', 'repair')
  if (!facts.connected) return verdict('info', 'disconnected')
  if (!facts.portOpen) return verdict('error', 'portBusy')
  if (facts.mode === 'enhanced' && !facts.tun)
    return verdict('warning', 'enhancedMissing', 'repair')
  if (facts.mode === 'standard' && !facts.systemProxy)
    return verdict('warning', 'systemProxyOff', 'repair')
  if (facts.clashMode === 'direct')
    return verdict('warning', 'directMode', 'smartMode')

  const route = facts.route ?? ''
  if (facts.routeDelay !== null && !isUsableDelay(facts.routeDelay))
    return verdict('error', 'routeDown', 'fastestRoute', { route })

  const foreign = timedStatus(facts.foreign, FOREIGN_SLOW_MS)
  const domestic = timedStatus(facts.domestic, DOMESTIC_SLOW_MS)
  const apps = facts.otherApps?.join(', ') ?? ''
  const global = facts.clashMode === 'global'

  if (foreign === 'fail') {
    return apps
      ? verdict('error', 'foreignDownApps', null, { apps })
      : verdict('error', 'foreignDown', 'fastestRoute', { route })
  }
  if (domestic === 'fail' || domestic === 'warn') {
    if (global) return verdict('warning', 'domesticSlowGlobal', 'smartMode')
    if (apps) return verdict('warning', 'domesticSlowApps', null, { apps })
    return verdict(
      'warning',
      domestic === 'fail' ? 'domesticDown' : 'domesticSlow',
      null,
      { ms: facts.domestic ?? 0 },
    )
  }
  if (apps) return verdict('warning', 'otherApps', null, { apps })
  if (foreign === 'warn')
    return verdict('warning', 'foreignSlow', 'fastestRoute', {
      ms: facts.foreign ?? 0,
    })
  if (global) return verdict('info', 'okGlobal', 'smartMode')
  if (domestic === 'ok' && foreign === 'ok')
    return verdict('success', 'ok', null, {
      domestic: facts.domestic ?? 0,
      foreign: facts.foreign ?? 0,
    })
  return verdict('success', 'okPartial')
}
