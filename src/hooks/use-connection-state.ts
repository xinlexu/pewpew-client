import { useIsMutating, useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useVerge } from '@/hooks/use-verge'
import { useClashConfigData } from '@/providers/app-data-context'
import { changeConnection, type ConnectionRequest } from '@/services/connection'
import { queryClient } from '@/services/query-client'
import { connectionMode } from '@/utils/connection-state'

const mutationKey = ['pewpewConnection']

export const refreshConnectionState = () =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: ['getVergeConfig'] }),
    queryClient.invalidateQueries({ queryKey: ['getSystemProxy'] }),
    queryClient.invalidateQueries({ queryKey: ['getAutotemProxy'] }),
    queryClient.invalidateQueries({ queryKey: ['getClashConfig'] }),
    queryClient.invalidateQueries({ queryKey: ['getSystemState'] }),
  ])

export function useConnectionState() {
  const { verge } = useVerge()
  const { indicator: systemProxy } = useSystemProxyState()
  const { clashConfig } = useClashConfigData()
  const busy = useIsMutating({ mutationKey }) > 0
  const { mutateAsync } = useMutation({
    mutationKey,
    mutationFn: (request: ConnectionRequest) => changeConnection(request),
    onSettled: async () => {
      await refreshConnectionState()
    },
  })
  const tun = clashConfig?.tun?.enable ?? verge?.enable_tun_mode ?? false
  const setConnected = useCallback(
    (enabled: boolean) => mutateAsync({ enabled }),
    [mutateAsync],
  )
  return {
    enabled: systemProxy || tun,
    configured: Boolean(verge?.enable_system_proxy || verge?.enable_tun_mode),
    systemProxy,
    tun,
    mode: connectionMode(verge || {}),
    accepted: verge?.pewpew_enhanced_accepted ?? false,
    busy,
    change: mutateAsync,
    setConnected,
  }
}
