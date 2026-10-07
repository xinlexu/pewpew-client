import { useIsMutating, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getBaseConfig } from 'tauri-plugin-mihomo-api'

import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useAppRefreshers } from '@/providers/app-data-context'
import { calcuProxies } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { resolvePewPewProxyGroup } from '@/utils/pewpew-client'

type EnsureRouteOptions = {
  // Routing mode to check; defaults to the core's current mode.
  mode?: string
  // Route to prefer when the current selection is not a real route.
  preferred?: string
}

// Validate the selected route against the core, not a stale rendered snapshot.
export const useRouteGuard = () => {
  const { t } = useTranslation()
  const { refreshProxy } = useAppRefreshers()
  const { selectRoute } = useProxySelection({
    onError: (error) => {
      console.error('[PewPew] 自动选择线路失败:', error)
    },
  })

  const { mutateAsync } = useMutation({
    mutationKey: ['pewpewRoutes', 'guard'],
    // Different requested modes must each be checked, in order.
    scope: { id: 'pewpewRouteGuard' },
    mutationFn: async (options: EnsureRouteOptions = {}) => {
      try {
        const [proxies, config] = await Promise.all([
          calcuProxies(),
          getBaseConfig().catch(() => {
            throw new Error('pewpew-core-unavailable')
          }),
        ])
        const mode = options.mode ?? config.mode
        const result = resolvePewPewProxyGroup(proxies, mode)
        if (!result.group || result.options.length === 0) {
          throw new Error('No usable route')
        }
        if (result.options.some((item) => item.name === result.currentName)) {
          return true
        }

        // Default to the route already picked in Smart mode so switching to
        // Global (or repairing an invalid selection) keeps the user's choice.
        const preferred =
          options.preferred ??
          resolvePewPewProxyGroup(proxies, 'rule').currentName
        const target =
          result.options.find((item) => item.name === preferred) ??
          result.options[0]
        if (!target.selectionPath?.length)
          throw new Error('No selectable route')

        const applied = await selectRoute(
          result.group.name,
          target.name,
          result.group.now,
          target.selectionPath,
        )
        if (applied) {
          const verified = resolvePewPewProxyGroup(await calcuProxies(), mode)
          if (
            !verified.options.some((item) => item.name === verified.currentName)
          ) {
            throw new Error('Route selection was not applied')
          }
          showNotice.info(
            t('home.pewpew.route.autoSelected', { name: target.name }),
          )
        } else {
          showNotice.error(t('home.pewpew.connection.routeChangeFailed'))
        }
        return applied
      } catch (error) {
        console.error('[PewPew] Route validation failed:', error)
        showNotice.error(
          t(
            error instanceof Error &&
              error.message === 'pewpew-core-unavailable'
              ? 'home.pewpew.connectionStatus.coreUnavailable'
              : 'home.pewpew.connection.routeChangeFailed',
          ),
        )
        return false
      }
    },
    onSettled: () => refreshProxy().catch(() => {}),
  })

  return { ensureValidRoute: mutateAsync }
}

export const useRoutesBusy = () =>
  useIsMutating({ mutationKey: ['pewpewRoutes'] }) > 0
