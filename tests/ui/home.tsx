// Test-only fixture: the full app with mocked IPC. It never calls the native
// service, changes the system proxy or touches the host network.
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'

const params = new URLSearchParams(location.search)
const scenario = params.get('scenario') || 'ready'
const theme = params.get('theme') || 'light'
const lang = params.get('lang') || 'zh'
const longNames = params.has('long')
const now = Math.floor(Date.now() / 1000)
const day = 86400
const GB = 1024 ** 3

localStorage.clear()
localStorage.setItem('pewpew-language-mode', lang === 'en' ? 'en-US' : 'zh-CN')
localStorage.setItem(
  'pewpew-auto-update-routes-on-startup',
  params.has('autoUpdate') ? 'true' : 'false',
)

const connected = ['connected', 'enhanced', 'failedEnhanced'].includes(scenario)
const enhanced =
  ['enhanced', 'failedEnhanced'].includes(scenario) ||
  params.has('enhancedMode')
const hasProfile = scenario !== 'empty'

const routeNames = longNames
  ? [
      '🇭🇰 香港 IEPL 专线 01 | 原生解锁 | 低延迟游戏优化 | 0.8x',
      '🇯🇵 日本 东京 BGP 02 | Netflix Disney+ 解锁 | 1.0x',
      '🇸🇬 新加坡 03',
      '🇺🇸 United States Los Angeles Premium Gaming Line 04',
    ]
  : [
      '🇭🇰 香港 01',
      '🇭🇰 香港 02',
      '🇯🇵 日本 01',
      '🇸🇬 新加坡 01',
      '🇹🇼 台湾 01',
      '🇺🇸 美国 01',
      '🇰🇷 韩国 01',
      '🇬🇧 英国 01',
    ]

const remaining =
  scenario === 'dataLow' ? 1.2 : scenario === 'exhausted' ? 0 : 86.42
const expireAt =
  scenario === 'expired'
    ? now - 3 * day
    : scenario === 'expiring'
      ? now + 3 * day
      : now + 58 * day
const infoNodes = [
  `剩余流量：${remaining} GB`,
  '距离下次重置剩余：12 天',
  `套餐到期：${new Date(expireAt * 1000).toISOString().slice(0, 10)}`,
]

const proxy = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: 'Shadowsocks',
  udp: !(params.has('noUdp') && name === routeNames[0]),
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
  history: [],
  alive: true,
  ...extra,
})

const records: Record<string, any> = {}
function populateRoutes() {
  records.DIRECT = proxy('DIRECT', { type: 'Direct' })
  records.REJECT = proxy('REJECT', { type: 'Reject' })
  infoNodes.forEach((name) => (records[name] = proxy(name)))
  routeNames.forEach((name, index) => {
    records[name] = proxy(name, {
      type:
        index % 3 === 0 ? 'Trojan' : index % 3 === 1 ? 'Shadowsocks' : 'Vmess',
      history: [
        {
          time: new Date().toISOString(),
          delay: [86, 142, 63, 230, 0, 410, 95, 180][index % 8],
        },
      ],
    })
  })
  records['自动选择'] = proxy('自动选择', {
    type: 'URLTest',
    all: routeNames,
    now: routeNames[0],
  })
  records['PewPew 云'] = proxy('PewPew 云', {
    type: 'Selector',
    all: [...infoNodes, '自动选择', ...routeNames],
    now:
      params.get('ruleNow') ||
      (params.has('infoSelected') ? infoNodes[0] : routeNames[0]),
  })
  records.GLOBAL = proxy('GLOBAL', {
    type: 'Selector',
    all: [
      'DIRECT',
      'REJECT',
      'PewPew 云',
      '自动选择',
      ...infoNodes,
      ...routeNames,
    ],
    now: params.get('globalNow') || 'PewPew 云',
  })
}
if (hasProfile) populateRoutes()

const state = {
  verge: {
    theme_mode: theme,
    language: lang,
    enable_system_proxy: connected,
    enable_tun_mode: connected && enhanced,
    pewpew_enhanced_mode: enhanced,
    pewpew_enhanced_accepted: enhanced || params.has('accepted'),
    verge_mixed_port: 7897,
    proxy_host: '127.0.0.1',
    auto_close_connection: true,
    enable_auto_launch: false,
    enable_silent_start: false,
    collapse_navbar: false,
    notice_position: 'top-right',
  } as Record<string, any>,
  profiles: hasProfile
    ? {
        current: 'R1',
        items: [
          {
            uid: 'R1',
            type: 'remote',
            name: 'PewPew 云',
            url: 'https://sub.example.invalid/api?token=demo',
            updated: now - 2 * 3600,
            option: { with_proxy: false, self_proxy: false },
            extra: {
              upload: 0,
              download: Math.round((200 - remaining) * GB),
              total: 200 * GB,
              expire: expireAt,
            },
          },
        ],
      }
    : { current: null, items: [] },
  config: {
    port: 0,
    socksPort: 0,
    redirPort: 0,
    tproxyPort: 0,
    mixedPort: 7897,
    allowLan: false,
    bindAddress: '*',
    mode: params.get('mode') || 'rule',
    logLevel: 'info',
    ipv6: false,
    tun: { enable: scenario === 'enhanced' },
  },
  system: { enable: connected, server: '127.0.0.1:7897', bypass: '' },
  coreDown: params.has('coreDown'),
}

const calls: Array<{ command: string; args: any; mode: string }> = []
;(window as any).homeTest = { state, records, calls, unknown: [] as string[] }

mockWindows('main')
mockIPC(
  async (cmd, args: any) => {
    calls.push({ command: cmd, args, mode: state.config.mode })
    // Real IPC is never instant; a small delay surfaces ordering bugs.
    if (params.has('slowIpc')) await new Promise((r) => setTimeout(r, 30))
    switch (cmd) {
      case 'get_verge_config':
        return structuredClone(state.verge)
      case 'patch_verge_config': {
        await new Promise((r) => setTimeout(r, 120))
        const patch = args.payload
        Object.assign(state.verge, patch)
        if (patch.enable_system_proxy !== undefined)
          state.system.enable = patch.enable_system_proxy
        if (patch.enable_tun_mode !== undefined)
          state.config.tun.enable = patch.enable_tun_mode
        return null
      }
      case 'get_profiles':
        if (params.has('profilesError')) throw new Error('profiles unavailable')
        if (params.get('slowProfiles'))
          await new Promise((r) =>
            setTimeout(r, Number(params.get('slowProfiles'))),
          )
        return structuredClone(state.profiles)
      case 'get_sys_proxy':
        return structuredClone(state.system)
      case 'get_auto_proxy':
        return { enable: false, url: '' }
      case 'get_running_mode':
        return 'Sidecar'
      case 'get_app_uptime':
        return 120000
      case 'is_service_available':
        return true
      case 'prepare_enhanced_connection':
        if (params.get('prepareError'))
          throw new Error(params.get('prepareError')!)
        return null
      case 'patch_clash_mode':
        if (params.has('failMode')) throw new Error('mode rejected')
        state.config.mode = args.payload
        return null
      case 'update_profile':
        await new Promise((r) =>
          setTimeout(r, Number(params.get('updateDelay') || 300)),
        )
        return null
      case 'enhance_profiles':
        return { status: 'valid' }
      case 'patch_profiles_config':
        Object.assign(state.profiles, args.profiles)
        populateRoutes()
        return { status: 'valid' }
      case 'import_profile':
      case 'create_profile':
        if (params.has('failImport')) throw new Error('import rejected')
        state.profiles.items.push({
          uid: 'R2',
          type: cmd === 'import_profile' ? 'remote' : 'local',
          name: 'Imported test routes',
          url: args.url,
          updated: now,
        } as any)
        return null
      case 'patch_profile':
      case 'sync_tray_proxy_selection':
        return null
      case 'plugin:mihomo|get_connections':
        return { connections: [] }
      case 'plugin:mihomo|get_base_config':
        if (state.coreDown) throw new Error('core unreachable')
        return structuredClone(state.config)
      case 'plugin:mihomo|get_proxies':
        if (params.get('slowProxies'))
          await new Promise((r) =>
            setTimeout(r, Number(params.get('slowProxies'))),
          )
        return { proxies: structuredClone(records) }
      case 'plugin:mihomo|get_proxy_providers':
        return { providers: {} }
      case 'plugin:mihomo|get_rules':
        return { rules: [] }
      case 'plugin:mihomo|get_rule_providers':
        return { providers: {} }
      case 'plugin:mihomo|delay_proxy_by_name':
        await new Promise((r) => setTimeout(r, 300))
        return { delay: 60 + Math.round(Math.random() * 200) }
      case 'plugin:mihomo|select_node_for_group': {
        if (params.get('selectionDelay')) {
          await new Promise((r) =>
            setTimeout(r, Number(params.get('selectionDelay'))),
          )
        }
        if (params.has('failSelection')) throw new Error('selection rejected')
        const group = records[args.groupName]
        if (group && !params.has('ignoreSelection')) group.now = args.node
        return null
      }
      case 'plugin:mihomo|close_all_connections':
      case 'plugin:mihomo|ws_cleanup_all':
        return null
      case 'plugin:app|version':
        return '0.1.0'
      case 'plugin:window|is_decorated':
        return true
      case 'plugin:window|is_maximized':
      case 'plugin:window|is_fullscreen':
        return false
      case 'plugin:window|theme':
        return theme
      case 'plugin:clipboard-manager|read_text':
        return '  https://sub.example.invalid/api?token=fixture  '
      case 'plugin:clipboard-manager|write_text':
        return null
      case 'plugin:dialog|open':
        if (params.has('failDialog')) throw new Error('dialog unavailable')
        return 'C:/fixture/routes.yaml'
      case 'plugin:fs|read_text_file':
        return Array.from(
          new TextEncoder().encode(
            'proxies:\n  - name: Tokyo\n    type: ss\n    server: 127.0.0.1\n    port: 1080\n    cipher: aes-128-gcm\n    password: fixture\n',
          ),
        )
      default:
        if (
          cmd.startsWith('plugin:window|') ||
          cmd.startsWith('plugin:webview|')
        )
          return null
        ;(window as any).homeTest.unknown.push(cmd)
        return null
    }
  },
  { shouldMockEvents: true },
)
{
  const internals = (window as any).__TAURI_INTERNALS__
  const original = internals.invoke
  const counts: Record<string, number> = {}
  ;(window as any).homeTest.counts = counts
  internals.invoke = (cmd: string, ...rest: unknown[]) => {
    counts[cmd] = (counts[cmd] || 0) + 1
    return original(cmd, ...rest)
  }
}

history.replaceState(null, '', '/')
await import('/src/main.tsx')

if (params.has('guardProbe')) {
  const { useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClientProvider } = await import('@tanstack/react-query')
  const { queryClient } = await import('@/services/query-client')
  const { RefreshersContext } = await import('@/providers/app-data-context')
  const { useRouteGuard } = await import('@/hooks/use-route-guard')
  function Probe() {
    const first = useRouteGuard()
    const second = useRouteGuard()
    useEffect(() => {
      ;(window as any).homeTest.ensureBoth = () =>
        Promise.all([
          first.ensureValidRoute({ mode: 'rule' }),
          second.ensureValidRoute({ mode: 'global' }),
        ])
    }, [first.ensureValidRoute, second.ensureValidRoute])
    return null
  }
  const node = document.createElement('div')
  document.body.append(node)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['getProxies'] })
  createRoot(node).render(
    <QueryClientProvider client={queryClient}>
      <RefreshersContext value={{ refreshProxy: refresh } as any}>
        <Probe />
      </RefreshersContext>
    </QueryClientProvider>,
  )
}
