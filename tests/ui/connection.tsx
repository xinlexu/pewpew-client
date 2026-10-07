import { Box, CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { mockIPC } from '@tauri-apps/api/mocks'
import { createRoot } from 'react-dom/client'
import { getBaseConfig } from 'tauri-plugin-mihomo-api'

import { ProxyTunCard } from '@/components/home/proxy-tun-card'
import { NoticeManager } from '@/components/layout/notice-manager'
import {
  ClashConfigContext,
  ProxiesContext,
  SystemContext,
} from '@/providers/app-data-context'
import { getSystemProxy } from '@/services/cmds'
import { changeConnection } from '@/services/connection'
import { initializeLanguage } from '@/services/i18n'
import { queryClient } from '@/services/query-client'

// Test-only IPC: never call the native service or modify the host network.
const params = new URLSearchParams(location.search)
const enhanced = params.has('enhanced')
const connected = params.has('connected')
const calls: Array<{ command: string; payload: any }> = []
const state = {
  settings: {
    enable_system_proxy: connected,
    enable_tun_mode: connected && enhanced,
    pewpew_enhanced_mode: enhanced,
    pewpew_enhanced_accepted: params.has('accepted'),
    verge_mixed_port: 7897,
  },
  system: { enable: connected, server: '127.0.0.1:7897', bypass: '' },
  config: {
    mode: 'rule',
    mixedPort: 7897,
    tun: { enable: connected && enhanced },
  },
  failPrepare: params.get('fail') === 'prepare',
  failTun: params.get('fail') === 'tun',
  failDisconnect: params.get('fail') === 'disconnect',
}

mockIPC(
  async (command, args) => {
    const payload = args as any
    calls.push({ command, payload })
    switch (command) {
      case 'get_verge_config':
        return structuredClone(state.settings)
      case 'get_sys_proxy':
        return structuredClone(state.system)
      case 'get_auto_proxy':
        return { enable: false, url: '' }
      case 'get_running_mode':
        return 'Sidecar'
      case 'plugin:mihomo|get_base_config':
        return structuredClone(state.config)
      case 'is_service_available':
        return !state.failPrepare
      case 'prepare_enhanced_connection':
        if (state.failPrepare) throw new Error('pewpew-service-conflict')
        return
      case 'patch_verge_config': {
        await new Promise((resolve) => setTimeout(resolve, 40))
        const patch = payload.payload
        if (patch.enable_tun_mode === true && state.failTun) {
          throw new Error('permission denied')
        }
        if (patch.enable_tun_mode === false && state.failDisconnect) {
          throw new Error('core unreachable')
        }
        Object.assign(state.settings, patch)
        if (patch.enable_system_proxy !== undefined)
          state.system.enable = patch.enable_system_proxy
        if (patch.enable_tun_mode !== undefined)
          state.config.tun.enable = patch.enable_tun_mode
        return
      }
      case 'plugin:mihomo|close_all_connections':
        return
      default:
        throw new Error(`Unexpected test command: ${command}`)
    }
  },
  { shouldMockEvents: true },
)

Object.assign(window, { connectionTest: { state, calls, changeConnection } })
queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 0 } })
await initializeLanguage(params.get('lang') || 'en')

const route = {
  name: 'Test route',
  type: 'Shadowsocks',
  udp: !params.has('noUdp'),
}
const group = {
  name: 'PROXY',
  type: 'Selector',
  now: route.name,
  all: [route.name],
}
const proxies = {
  groups: [group],
  records: { [route.name]: route, PROXY: group },
}

function Fixture() {
  const { data: clashConfig } = useQuery({
    queryKey: ['getClashConfig'],
    queryFn: getBaseConfig,
  })
  const { data: sysproxy } = useQuery({
    queryKey: ['getSystemProxy'],
    queryFn: getSystemProxy,
  })
  return (
    <ThemeProvider
      theme={createTheme({
        palette: { mode: params.has('dark') ? 'dark' : 'light' },
      })}
    >
      <CssBaseline />
      <ClashConfigContext
        value={{ clashConfig, isClashConfigPending: !clashConfig }}
      >
        <SystemContext
          value={{
            sysproxy,
            runningMode: 'Sidecar',
            systemProxyAddress: '127.0.0.1:7897',
          }}
        >
          <ProxiesContext
            value={{ proxies, proxyProviders: {}, isProxiesPending: false }}
          >
            <Box sx={{ width: '100%', maxWidth: 488, mx: 'auto', p: 3 }}>
              <ProxyTunCard
                hasRoute={!params.has('noRoute')}
                onRepairNetwork={() => changeConnection({ enabled: false })}
              />
            </Box>
            <NoticeManager />
          </ProxiesContext>
        </SystemContext>
      </ClashConfigContext>
    </ThemeProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <Fixture />
  </QueryClientProvider>,
)
