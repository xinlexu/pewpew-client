import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { useRouteGuard } from '@/hooks/use-route-guard'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import { patchClashMode } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { resolvePewPewProxyGroup } from '@/utils/pewpew-client'

export type VisibleClashMode = 'rule' | 'global'

// Switches between Smart and Global mode, keeping the user's route. Shared by
// the mode toggle and the connection check.
export const useClashModeChange = () => {
  const { t } = useTranslation()
  const { verge } = useVerge()
  const { clashConfig } = useClashConfigData()
  const { proxies } = useProxiesData()
  const { refreshClashConfig } = useAppRefreshers()
  const { ensureValidRoute } = useRouteGuard()

  return useMutation({
    mutationKey: ['pewpewRoutes', 'mode'],
    mutationFn: async (mode: VisibleClashMode): Promise<boolean> => {
      const preferred = resolvePewPewProxyGroup(
        proxies,
        clashConfig?.mode,
      ).currentName
      try {
        // Prepare the target group before making it carry live traffic.
        if (!(await ensureValidRoute({ mode, preferred }))) return false
        await patchClashMode(mode)
        if (verge?.auto_close_connection) {
          await closeAllConnections().catch(() => {})
        }
        return true
      } catch (error) {
        console.error('Failed to change mode:', error)
        showNotice.error(t('home.pewpew.connection.modeChangeFailed'))
        return false
      } finally {
        await refreshClashConfig().catch(() => {})
      }
    },
  })
}
