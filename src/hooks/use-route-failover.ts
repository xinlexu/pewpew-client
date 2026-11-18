import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { delayProxyByName, getBaseConfig } from 'tauri-plugin-mihomo-api'

import { useFastestRoute } from '@/hooks/use-fastest-route'
import { useRoutesBusy } from '@/hooks/use-route-guard'
import { calcuProxies } from '@/services/cmds'
import delayManager from '@/services/delay'
import { showNotice } from '@/services/notice-service'
import { resolvePewPewProxyGroup } from '@/utils/pewpew-client'
import { isUsableDelay, selectionUsesAutoGroup } from '@/utils/route-health'

// How often the current route is checked while connected, and how long to
// wait before confirming a failure. A dead route is replaced within about
// CHECK_INTERVAL + CONFIRM_DELAY.
export const FAILOVER_CHECK_INTERVAL = 30_000
export const FAILOVER_CONFIRM_DELAY = 5_000
// After switching, give the new route time before judging it.
const SWITCH_COOLDOWN = 60_000
const ALL_DOWN_NOTICE_GAP = 10 * 60_000
const PROBE_TIMEOUT = 5000

const AUTO_SWITCH_KEY = 'pewpew-auto-switch-route'

export const readAutoSwitchRoute = () => {
  try {
    return localStorage.getItem(AUTO_SWITCH_KEY) !== 'false'
  } catch {
    return true
  }
}

export const writeAutoSwitchRoute = (enabled: boolean) => {
  try {
    localStorage.setItem(AUTO_SWITCH_KEY, String(enabled))
  } catch {}
}

const probe = async (name: string, url: string) => {
  try {
    const result = await delayProxyByName(name, url, PROBE_TIMEOUT)
    return result.delay
  } catch {
    return 0
  }
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms))

// While connected, checks the current route in the background and moves to
// the fastest working route when it stops answering. Automatic groups
// (url-test, fallback) already do this themselves and are left alone.
export const useRouteFailover = (active: boolean) => {
  const { t } = useTranslation()
  const routesBusy = useRoutesBusy()
  const switchToFastest = useFastestRoute()
  const latestRef = useRef({ t, routesBusy, switchToFastest })
  useEffect(() => {
    latestRef.current = { t, routesBusy, switchToFastest }
  })

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    let timer = 0
    let lastAllDownNotice = 0

    const checkOnce = async (): Promise<number> => {
      if (latestRef.current.routesBusy) return FAILOVER_CHECK_INTERVAL
      const [proxies, config] = await Promise.all([
        calcuProxies(),
        getBaseConfig(),
      ])
      const mode = config.mode?.toLowerCase()
      if (mode !== 'rule' && mode !== 'global') return FAILOVER_CHECK_INTERVAL
      const { group, options, currentName } = resolvePewPewProxyGroup(
        proxies,
        mode,
      )
      const current = options.find((option) => option.name === currentName)
      if (
        !group ||
        !current ||
        options.length < 2 ||
        selectionUsesAutoGroup(proxies.records ?? {}, group.name)
      ) {
        return FAILOVER_CHECK_INTERVAL
      }

      const url = delayManager.getUrl(group.name)
      let delay = await probe(current.name, url)
      if (!isUsableDelay(delay)) {
        // One slow answer is not a dead route.
        await wait(FAILOVER_CONFIRM_DELAY)
        if (cancelled) return FAILOVER_CHECK_INTERVAL
        delay = await probe(current.name, url)
      }
      if (cancelled) return FAILOVER_CHECK_INTERVAL
      delayManager.setDelay(
        current.name,
        group.name,
        isUsableDelay(delay) ? delay : 0,
      )
      if (isUsableDelay(delay) || latestRef.current.routesBusy) {
        return FAILOVER_CHECK_INTERVAL
      }

      const result = await latestRef.current.switchToFastest(current.name)
      if (cancelled) return FAILOVER_CHECK_INTERVAL
      const { t: translate } = latestRef.current
      if (result.status === 'switched') {
        showNotice.info(
          translate('home.pewpew.failover.switched', {
            from: result.from,
            to: result.to,
            delay: result.delay,
          }),
        )
        return SWITCH_COOLDOWN
      }
      if (
        result.status === 'allDown' &&
        Date.now() - lastAllDownNotice > ALL_DOWN_NOTICE_GAP
      ) {
        lastAllDownNotice = Date.now()
        showNotice.error(translate('home.pewpew.failover.allDown'))
      }
      return FAILOVER_CHECK_INTERVAL
    }

    const tick = async () => {
      let next = FAILOVER_CHECK_INTERVAL
      try {
        next = await checkOnce()
      } catch (error) {
        console.warn('[PewPew] 线路自动检测失败:', error)
      }
      if (!cancelled) timer = window.setTimeout(tick, next)
    }

    timer = window.setTimeout(tick, FAILOVER_CHECK_INTERVAL)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active])
}
