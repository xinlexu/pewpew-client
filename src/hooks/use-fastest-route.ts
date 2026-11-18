import { useCallback } from 'react'
import { getBaseConfig } from 'tauri-plugin-mihomo-api'

import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useAppRefreshers } from '@/providers/app-data-context'
import { calcuProxies } from '@/services/cmds'
import delayManager from '@/services/delay'
import { resolvePewPewProxyGroup } from '@/utils/pewpew-client'
import { pickFastestRoute } from '@/utils/route-health'

const ROUTE_TEST_TIMEOUT = 5000

export type FastestRouteResult =
  | { status: 'switched'; from: string; to: string; delay: number }
  // Every other route failed too: most likely the local network is down.
  | { status: 'allDown' }
  // No route list, or switching failed.
  | { status: 'unavailable' }

// Tests the routes of the current group and moves to the fastest one that
// answers. The choice counts as automatic, like the route guard's.
export const useFastestRoute = () => {
  const { refreshProxy } = useAppRefreshers()
  const { selectRoute } = useProxySelection({
    manual: false,
    onError: (error) => {
      console.error('[PewPew] 切换到最快线路失败:', error)
    },
  })

  return useCallback(
    async (exclude?: string): Promise<FastestRouteResult> => {
      try {
        const [proxies, config] = await Promise.all([
          calcuProxies(),
          getBaseConfig(),
        ])
        const { group, options, currentName } = resolvePewPewProxyGroup(
          proxies,
          config.mode,
        )
        if (!group) return { status: 'unavailable' }
        const skip = exclude ?? currentName
        const candidates = options.filter((option) => option.name !== skip)
        if (candidates.length === 0) return { status: 'unavailable' }

        await delayManager.checkListDelay(
          candidates.map((option) => option.name),
          group.name,
          ROUTE_TEST_TIMEOUT,
          10,
        )
        const best = pickFastestRoute(candidates, (option) =>
          delayManager.getDelay(option.name, group.name),
        )
        if (!best) return { status: 'allDown' }

        const applied = await selectRoute(
          group.name,
          best.option.name,
          group.now,
          best.option.selectionPath,
        )
        return applied
          ? {
              status: 'switched',
              from: currentName,
              to: best.option.name,
              delay: best.delay,
            }
          : { status: 'unavailable' }
      } catch (error) {
        console.error('[PewPew] 查找最快线路失败:', error)
        return { status: 'unavailable' }
      } finally {
        refreshProxy().catch(() => {})
      }
    },
    [refreshProxy, selectRoute],
  )
}
