import { InfoOutlined, SettingsRounded } from '@mui/icons-material'
import {
  Box,
  Button,
  ButtonBase,
  Stack,
  Tooltip,
  Typography,
  alpha,
  useTheme,
  type Theme,
} from '@mui/material'
import { getVersion } from '@tauri-apps/api/app'
import dayjs from 'dayjs'
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { getBaseConfig } from 'tauri-plugin-mihomo-api'

import pewpewLogo from '@/assets/pewpew-logo.jpg'
import { AccountSummary } from '@/components/home/account-summary'
import { ClashModeCard } from '@/components/home/clash-mode-card'
import { CurrentProxyCard } from '@/components/home/current-proxy-card'
import { HomeProfileCard } from '@/components/home/home-profile-card'
import {
  AboutDialog,
  PreferencesDialog,
} from '@/components/home/pewpew-dialogs'
import {
  PEWPEW_WECHAT_ID,
  WECHAT_GREEN,
  copyToClipboard,
  glassOutlinedButtonSx,
  hairlineColor,
  isLightTheme,
  pillButtonSx,
  reducedMotion,
  surfaceSx,
} from '@/components/home/pewpew-ui'
import { ProxyTunCard } from '@/components/home/proxy-tun-card'
import {
  refreshConnectionState,
  useConnectionState,
} from '@/hooks/use-connection-state'
import { useProfiles } from '@/hooks/use-profiles'
import { useRouteGuard, useRoutesBusy } from '@/hooks/use-route-guard'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
  useCoreDataStatus,
  useProxiesData,
} from '@/providers/app-data-context'
import { enhanceProfiles, patchClashMode, updateProfile } from '@/services/cmds'
import delayManager from '@/services/delay'
import { showNotice } from '@/services/notice-service'
import {
  PEWPEW_LAST_YAML_PROFILE_KEY,
  PEWPEW_UNKNOWN_STATUS,
  PewPewAccountEvaluation,
  evaluatePewPewAccountState,
  extractPewPewSubscriptionStatus,
  resolvePewPewProxyGroup,
} from '@/utils/pewpew-client'

const AUTO_UPDATE_ROUTES_ON_STARTUP_KEY = 'pewpew-auto-update-routes-on-startup'

// Blurred color fields (blue, violet, mint) that the glass cards sit on.
const GLASS_BACKDROP = {
  light: {
    base: '#eef3fb',
    fields: [
      'radial-gradient(58% 66% at 6% 2%, rgba(147, 197, 253, 0.9), rgba(147, 197, 253, 0) 72%)',
      'radial-gradient(50% 60% at 100% 36%, rgba(196, 181, 253, 0.78), rgba(196, 181, 253, 0) 72%)',
      'radial-gradient(54% 50% at 42% 106%, rgba(153, 246, 228, 0.78), rgba(153, 246, 228, 0) 72%)',
      '#eef3fb',
    ].join(', '),
  },
  dark: {
    base: '#0b1020',
    fields: [
      'radial-gradient(58% 66% at 6% 2%, rgba(37, 99, 235, 0.5), rgba(37, 99, 235, 0) 72%)',
      'radial-gradient(50% 60% at 100% 36%, rgba(124, 58, 237, 0.38), rgba(124, 58, 237, 0) 72%)',
      'radial-gradient(54% 50% at 42% 106%, rgba(13, 148, 136, 0.38), rgba(13, 148, 136, 0) 72%)',
      '#0b1020',
    ].join(', '),
  },
}

const readAutoUpdateRoutesOnStartup = () => {
  try {
    return localStorage.getItem(AUTO_UPDATE_ROUTES_ON_STARTUP_KEY) !== 'false'
  } catch {
    return true
  }
}

const writeAutoUpdateRoutesOnStartup = (enabled: boolean) => {
  try {
    localStorage.setItem(AUTO_UPDATE_ROUTES_ON_STARTUP_KEY, String(enabled))
  } catch {}
}

const getReadableError = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

const getProfileDiagnosticsType = (profile?: IProfileItem | null) => {
  if (!profile?.uid) return 'unknown'
  if (profile.type === 'remote') return 'remote-subscription'
  if (profile.type === 'local') return 'local-yaml'
  return 'unknown'
}

const getAccountBlockedText = (
  evaluation: PewPewAccountEvaluation,
  t: (key: string) => string,
) => {
  if (evaluation.blockReason === 'expired') {
    return t('home.pewpew.account.planExpiredShort')
  }
  if (evaluation.blockReason === 'dataExhausted') {
    return t('home.pewpew.account.dataExhaustedShort')
  }
  return ''
}

const getAccountBlockedContinueText = (
  evaluation: PewPewAccountEvaluation,
  t: (key: string) => string,
) => {
  if (evaluation.blockReason === 'expired') {
    return t('home.pewpew.account.planExpiredContinue')
  }
  if (evaluation.blockReason === 'dataExhausted') {
    return t('home.pewpew.account.dataExhaustedContinue')
  }
  return ''
}

const HomePage = () => {
  const theme = useTheme()
  const { i18n, t } = useTranslation()
  const {
    profiles,
    current,
    mutateProfiles,
    error: profilesError,
  } = useProfiles()
  const { proxies } = useProxiesData()
  const { refreshAll, refreshClashConfig } = useAppRefreshers()
  const { clashConfig } = useClashConfigData()
  const { isCoreDataPending } = useCoreDataStatus()
  const { verge } = useVerge()
  const {
    enabled: connectionEnabled,
    setConnected,
    mode: connectionMode,
    tun: tunEnabled,
    systemProxy: systemProxyEnabled,
    busy: connectionBusy,
  } = useConnectionState()
  const { ensureValidRoute } = useRouteGuard()
  const routesBusy = useRoutesBusy()
  const [preparingConnection, setPreparingConnection] = useState(false)
  const controlsBusy = connectionBusy || routesBusy || preparingConnection
  const [lineSyncing, setLineSyncing] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [repairingNetwork, setRepairingNetwork] = useState(false)
  const [lastConnectionError, setLastConnectionError] = useState('')
  const [autoUpdateRoutesOnStartup, setAutoUpdateRoutesOnStartup] = useState(
    readAutoUpdateRoutesOnStartup,
  )
  const [, refreshDelaySummary] = useReducer((value: number) => value + 1, 0)
  const startupUpdateRanRef = useRef(false)
  const routeRepairKeyRef = useRef('')

  const subscriptionStatus = useMemo(
    () => extractPewPewSubscriptionStatus(current, proxies),
    [current, proxies],
  )
  const accountEvaluation = useMemo(
    () => evaluatePewPewAccountState(subscriptionStatus),
    [subscriptionStatus],
  )
  const isDark = theme.palette.mode === 'dark'
  const proxyGroupResult = useMemo(
    () => resolvePewPewProxyGroup(proxies, clashConfig?.mode),
    [proxies, clashConfig?.mode],
  )

  const profilesLoaded = profiles !== undefined || !!profilesError
  // Keep the connection card while connected so the user can always disconnect.
  const stage: 'loading' | 'onboarding' | 'hub' = !profilesLoaded
    ? 'loading'
    : current || connectionEnabled
      ? 'hub'
      : 'onboarding'
  const hasUsableRoutes = proxyGroupResult.options.length > 0
  const routesLoading =
    stage === 'loading' || (isCoreDataPending && !hasUsableRoutes)
  const currentLine =
    proxyGroupResult.options.find(
      (item) => item.name === proxyGroupResult.currentName,
    ) ?? null
  const currentRouteValid = !!currentLine

  const currentDelayText = (() => {
    const { group } = proxyGroupResult
    if (!group || !currentLine) return ''
    const cachedDelay = delayManager.getDelayUpdate(
      currentLine.name,
      group.name,
    )
    const delay =
      cachedDelay && cachedDelay.delay >= 0
        ? cachedDelay.delay
        : delayManager.getDelayFix(currentLine.record, group.name)
    return delay > 0 && delay < 10000
      ? `${delayManager.formatDelay(delay)} ${t('home.pewpew.delay.unit')}`
      : ''
  })()

  const accountBlockedText = getAccountBlockedText(accountEvaluation, t)
  const accountBlockedContinueText = getAccountBlockedContinueText(
    accountEvaluation,
    t,
  )
  const modeLabel =
    clashConfig?.mode === 'global'
      ? t('home.pewpew.connection.globalMode')
      : clashConfig?.mode === 'direct'
        ? t('home.pewpew.connection.directMode')
        : t('home.pewpew.connection.smartMode')

  const pendingLabel = routesLoading
    ? t('home.pewpew.connectionStatus.loading')
    : lineSyncing
      ? t('home.pewpew.connectionStatus.updatingRoutes')
      : undefined

  const { statusDetail, statusTone } = ((): {
    statusDetail?: string
    statusTone: 'default' | 'warning' | 'error'
  } => {
    if (pendingLabel) return { statusTone: 'default' }
    if (accountEvaluation.blocked)
      return { statusDetail: accountBlockedText, statusTone: 'error' }
    if (!hasUsableRoutes)
      return {
        statusDetail: t('home.pewpew.connection.noAvailableRoutes'),
        statusTone: 'warning',
      }
    if (clashConfig?.mode === 'direct')
      return {
        statusDetail: connectionEnabled
          ? t('home.pewpew.connection.directModeActive')
          : t('home.pewpew.connection.directModeBeforeConnect'),
        statusTone: 'warning',
      }
    if (!currentLine)
      return {
        statusDetail: connectionEnabled
          ? t('home.pewpew.route.invalidWhileConnected')
          : t('home.pewpew.route.noneSelected'),
        statusTone: 'warning',
      }
    return {
      statusDetail: [modeLabel, currentLine.name, currentDelayText]
        .filter(Boolean)
        .join(' · '),
      statusTone: 'default',
    }
  })()

  const handleDelayUpdated = useCallback(() => {
    refreshDelaySummary()
  }, [])

  const handleCopyWechat = useCallback(async () => {
    try {
      await copyToClipboard(PEWPEW_WECHAT_ID)
      showNotice.success(t('home.pewpew.header.wechatCopied'))
    } catch {
      showNotice.error(t('home.pewpew.diagnostics.copyFailed'))
    }
  }, [t])

  const handleRepairNetwork = useCallback(async () => {
    setRepairingNetwork(true)

    try {
      await setConnected(false)
      await refreshConnectionState()
      setLastConnectionError('')
      showNotice.success(t('home.pewpew.connectionStatus.repairSuccess'))
    } catch (error) {
      console.error('[PewPew] 恢复网络失败:', error)
      setLastConnectionError(getReadableError(error) || 'repair-failed')
      showNotice.error(t('home.pewpew.connectionStatus.repairFailed'))
      throw error
    } finally {
      setRepairingNetwork(false)
    }
  }, [setConnected, t])

  const handleCopyDiagnostics = useCallback(async () => {
    try {
      const appVersion = await getVersion().catch(() => 'unknown')
      const hasSubscriptionStatus = Object.values(subscriptionStatus).some(
        (value) => value !== PEWPEW_UNKNOWN_STATUS,
      )
      let lastYamlProfileUid: string | null = null
      try {
        lastYamlProfileUid = localStorage.getItem(PEWPEW_LAST_YAML_PROFILE_KEY)
      } catch {}
      const diagnostics = [
        'PewPew Cloud Client Diagnostics',
        `Version: ${appVersion}`,
        `OS: ${navigator.platform || 'unknown'} (${navigator.userAgent || 'unknown'})`,
        `Language: ${i18n.language || 'unknown'}`,
        `Theme: ${verge?.theme_mode ?? theme.palette.mode}`,
        `Connection: ${connectionEnabled ? 'connected' : 'disconnected'}`,
        `Connection mode: ${connectionMode}`,
        `System proxy: ${systemProxyEnabled ? 'enabled' : 'disabled'}`,
        `Enhanced routing: ${tunEnabled ? 'enabled' : 'disabled'}`,
        `Route UDP capability: ${String(proxies?.records?.[proxyGroupResult.currentName]?.udp ?? 'unknown')}`,
        'Voice connectivity: not tested',
        `Current route: ${currentLine?.name || 'not selected'}`,
        `Current route valid: ${currentRouteValid ? 'yes' : 'no'}`,
        `Mode: ${clashConfig?.mode || 'unknown'}`,
        `Last route update: ${
          current?.updated
            ? dayjs(current.updated * 1000).format('YYYY-MM-DD HH:mm:ss')
            : 'never'
        }`,
        `Last connection error: ${lastConnectionError || 'none'}`,
        `Has usable routes: ${hasUsableRoutes ? 'yes' : 'no'}`,
        `Has subscription status: ${hasSubscriptionStatus ? 'yes' : 'no'}`,
        `Profile type: ${getProfileDiagnosticsType(current)}`,
        `Current profile just imported YAML: ${
          current?.uid && lastYamlProfileUid === current.uid ? 'yes' : 'no'
        }`,
        `Account state: ${accountEvaluation.state}`,
        `Blocked by expired plan: ${accountEvaluation.expired ? 'yes' : 'no'}`,
        `Blocked by exhausted data: ${
          accountEvaluation.dataExhausted ? 'yes' : 'no'
        }`,
        `Route count: ${proxyGroupResult.options.length}`,
        `Filtered informational items: ${proxyGroupResult.filteredInfoCount}`,
        `Main proxy group: ${proxyGroupResult.group?.name || 'none'}`,
        `Generated at: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`,
      ].join('\n')

      await copyToClipboard(diagnostics)
      showNotice.success(t('home.pewpew.diagnostics.copySuccess'))
    } catch (error) {
      console.error('[PewPew] 复制诊断信息失败:', error)
      showNotice.error(t('home.pewpew.diagnostics.copyFailed'))
    }
  }, [
    clashConfig?.mode,
    connectionEnabled,
    connectionMode,
    systemProxyEnabled,
    tunEnabled,
    proxies,
    proxyGroupResult.currentName,
    current,
    currentLine?.name,
    currentRouteValid,
    hasUsableRoutes,
    i18n.language,
    lastConnectionError,
    accountEvaluation,
    proxyGroupResult.filteredInfoCount,
    proxyGroupResult.group?.name,
    proxyGroupResult.options.length,
    subscriptionStatus,
    t,
    theme.palette.mode,
    verge?.theme_mode,
  ])

  const handleAutoUpdateRoutesOnStartupChange = useCallback(
    (enabled: boolean) => {
      writeAutoUpdateRoutesOnStartup(enabled)
      setAutoUpdateRoutesOnStartup(enabled)
    },
    [],
  )

  const handleBeforeConnect = useCallback(async () => {
    setPreparingConnection(true)
    try {
      const config = await getBaseConfig().catch(() => {
        throw new Error('pewpew-core-unavailable')
      })
      // Connecting in direct mode would bypass every route; use Smart mode.
      if (config.mode?.toLowerCase() === 'direct') {
        if (!(await ensureValidRoute({ mode: 'rule' }))) return false
        try {
          await patchClashMode('rule')
          await refreshClashConfig()
          showNotice.info(t('home.pewpew.route.switchedToSmart'))
        } catch (error) {
          console.error('[PewPew] 切换到智能模式失败:', error)
          showNotice.error(t('home.pewpew.connection.modeChangeFailed'))
          return false
        }
        return true
      }
      return await ensureValidRoute({})
    } finally {
      setPreparingConnection(false)
    }
  }, [ensureValidRoute, refreshClashConfig, t])

  useEffect(() => {
    if (startupUpdateRanRef.current) return
    if (
      !autoUpdateRoutesOnStartup ||
      !current?.uid ||
      current.type !== 'remote'
    )
      return
    if (connectionEnabled || lineSyncing || connectionBusy) {
      startupUpdateRanRef.current = true
      return
    }

    startupUpdateRanRef.current = true
    queueMicrotask(() => setLineSyncing(true))

    void (async () => {
      try {
        await updateProfile(current.uid, current.option)
        const enhanced = await enhanceProfiles()
        if (!enhanced) throw new Error('route enhancement failed')
        await mutateProfiles()
        await refreshAll()
      } catch (error) {
        console.error('[PewPew] 启动时自动更新线路失败:', error)
        showNotice.info(t('home.pewpew.subscription.autoUpdateFailed'))
      } finally {
        setLineSyncing(false)
      }
    })()
  }, [
    autoUpdateRoutesOnStartup,
    connectionEnabled,
    current?.option,
    current?.uid,
    current?.type,
    lineSyncing,
    connectionBusy,
    mutateProfiles,
    refreshAll,
    t,
  ])

  // While connected, never leave traffic on an info node or DIRECT: pick a
  // real route (e.g. after the tray switches to global mode).
  useEffect(() => {
    if (currentRouteValid) {
      routeRepairKeyRef.current = ''
      return
    }
    if (!connectionEnabled || controlsBusy || lineSyncing) return
    if (!hasUsableRoutes) return
    const key = `${clashConfig?.mode}|${proxyGroupResult.group?.name}|${proxyGroupResult.currentName}`
    if (routeRepairKeyRef.current === key) return
    routeRepairKeyRef.current = key
    void ensureValidRoute({})
  }, [
    clashConfig?.mode,
    controlsBusy,
    connectionEnabled,
    currentRouteValid,
    ensureValidRoute,
    hasUsableRoutes,
    lineSyncing,
    proxyGroupResult.currentName,
    proxyGroupResult.group?.name,
  ])

  const blockedFooter = accountEvaluation.blocked ? (
    <Stack spacing={0.75} sx={{ alignItems: 'center', maxWidth: 380 }}>
      <Button
        variant="outlined"
        onClick={() => void handleCopyWechat()}
        startIcon={<WeChatBadge size={20} />}
        sx={[glassOutlinedButtonSx, { px: 2 }]}
      >
        {t('home.pewpew.account.contactSupport')}
      </Button>
      <Typography variant="caption" color="text.secondary">
        {t('home.pewpew.account.renewHint')}
      </Typography>
    </Stack>
  ) : undefined

  return (
    <Box
      className="pewpew-shell"
      data-pewpew-theme={isDark ? 'dark' : 'light'}
      sx={{
        position: 'relative',
        isolation: 'isolate',
        height: '100%',
        minHeight: '100%',
        overflow: 'auto',
        overflowX: 'hidden',
        boxSizing: 'border-box',
        px: { xs: 2, md: 3 },
        py: { xs: 1.5, md: 2 },
        bgcolor: isDark ? GLASS_BACKDROP.dark.base : GLASS_BACKDROP.light.base,
        // Soft color fields behind the glass cards; light and dark cross-fade.
        '&::before, &::after': {
          content: '""',
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          pointerEvents: 'none',
          transition: 'opacity 320ms ease',
        },
        '&::before': {
          zIndex: -2,
          opacity: isDark ? 0 : 1,
          background: GLASS_BACKDROP.light.fields,
        },
        '&::after': {
          zIndex: -1,
          opacity: isDark ? 1 : 0,
          background: GLASS_BACKDROP.dark.fields,
        },
        [reducedMotion]: {
          '&::before, &::after': { transition: 'none' },
        },
      }}
    >
      <Stack
        className="pewpew-content"
        spacing={2}
        sx={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 980,
          mx: 'auto',
          pb: 3,
          boxSizing: 'border-box',
        }}
      >
        <PewPewHeader
          onAbout={() => setAboutOpen(true)}
          onPreferences={() => setPreferencesOpen(true)}
          onCopyWechat={() => void handleCopyWechat()}
        />

        {stage !== 'onboarding' && (
          <Box
            component="section"
            aria-label={t('home.pewpew.connectionStatus.title')}
            sx={[
              surfaceSx('primary'),
              { px: { xs: 2, sm: 3 }, py: { xs: 2.5, sm: 2.75 } },
            ]}
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  md: 'minmax(0, 1fr) minmax(0, 1fr)',
                },
                gap: { xs: 3, md: 4 },
                alignItems: 'start',
              }}
            >
              <ProxyTunCard
                connectionBlocked={accountEvaluation.blocked}
                connectionBlockedText={accountBlockedContinueText}
                disabled={
                  (routesLoading && !connectionEnabled) ||
                  lineSyncing ||
                  routesBusy ||
                  preparingConnection
                }
                hasRoute={hasUsableRoutes}
                onConnectionError={setLastConnectionError}
                connectionError={lastConnectionError}
                onCopyDiagnostics={handleCopyDiagnostics}
                onRepairNetwork={handleRepairNetwork}
                repairing={repairingNetwork}
                statusDetail={statusDetail}
                statusTone={statusTone}
                pendingLabel={pendingLabel}
                beforeConnect={handleBeforeConnect}
                footer={blockedFooter}
              />

              <Stack
                spacing={2.25}
                sx={(theme) => ({
                  minWidth: 0,
                  [theme.breakpoints.up('md')]: {
                    pl: 4,
                    borderLeft: `1px solid ${hairlineColor(theme)}`,
                  },
                })}
              >
                <CurrentProxyCard
                  embedded
                  loading={stage === 'loading'}
                  disabled={lineSyncing || controlsBusy}
                  routeBlocked={accountEvaluation.blocked}
                  routeBlockedText={accountBlockedText}
                  onDelayUpdated={handleDelayUpdated}
                />
                <ClashModeCard
                  disabled={lineSyncing || routesLoading || controlsBusy}
                />
                <AccountSummary
                  status={subscriptionStatus}
                  evaluation={accountEvaluation}
                  profile={current}
                  loading={routesLoading}
                />
              </Stack>
            </Box>
          </Box>
        )}

        {stage !== 'loading' && (
          <HomeProfileCard
            variant={stage === 'onboarding' ? 'onboarding' : 'compact'}
            current={current}
            busy={lineSyncing || controlsBusy}
            onProfileUpdated={mutateProfiles}
            onSyncingChange={setLineSyncing}
          />
        )}
      </Stack>

      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        onCopyDiagnostics={handleCopyDiagnostics}
      />
      <PreferencesDialog
        autoUpdateRoutesOnStartup={autoUpdateRoutesOnStartup}
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        onAutoUpdateRoutesOnStartupChange={
          handleAutoUpdateRoutesOnStartupChange
        }
        onCopyDiagnostics={handleCopyDiagnostics}
        onRepairNetwork={handleRepairNetwork}
        repairingNetwork={repairingNetwork}
      />
    </Box>
  )
}

const PewPewHeader = ({
  onAbout,
  onPreferences,
  onCopyWechat,
}: {
  onAbout: () => void
  onPreferences: () => void
  onCopyWechat: () => void
}) => {
  const { t } = useTranslation()

  const headerButtonSx = (theme: Theme) => ({
    ...pillButtonSx,
    minWidth: { xs: 40, sm: 64 },
    height: 40,
    px: { xs: 1, sm: 1.5 },
    color: 'text.primary',
    '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.75 }, ml: { xs: 0 } },
    '&:hover': {
      bgcolor: isLightTheme(theme)
        ? alpha('#ffffff', 0.55)
        : alpha('#ffffff', 0.07),
    },
  })

  return (
    <Box
      component="header"
      data-tauri-drag-region="true"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        minHeight: 56,
      }}
    >
      <Stack
        direction="row"
        spacing={1.25}
        data-tauri-drag-region="true"
        sx={{ alignItems: 'center', minWidth: 0 }}
      >
        <Box
          component="img"
          src={pewpewLogo}
          alt=""
          data-tauri-drag-region="false"
          sx={(theme) => ({
            width: { xs: 42, sm: 46 },
            height: { xs: 42, sm: 46 },
            objectFit: 'cover',
            borderRadius: '14px',
            flexShrink: 0,
            boxShadow: isLightTheme(theme)
              ? '0 8px 20px rgba(36, 87, 214, 0.25) !important'
              : '0 8px 20px rgba(0, 0, 0, 0.4) !important',
          })}
        />
        <Box sx={{ minWidth: 0 }} data-tauri-drag-region="true">
          <Typography
            variant="h5"
            component="h1"
            noWrap
            sx={{
              fontWeight: 800,
              lineHeight: 1.2,
              fontSize: { xs: 18, sm: 21 },
            }}
          >
            {t('home.pewpew.header.title')}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            noWrap
            sx={{ mt: 0.25, fontWeight: 500, fontSize: { xs: 12.5, sm: 13.5 } }}
          >
            {t('home.pewpew.header.subtitle')}
          </Typography>
        </Box>
      </Stack>

      <Stack
        direction="row"
        spacing={{ xs: 0.25, sm: 0.75 }}
        data-tauri-drag-region="false"
        sx={{ alignItems: 'center', flexShrink: 0 }}
      >
        <Tooltip title={t('home.pewpew.header.copyWechat')}>
          <ButtonBase
            onClick={onCopyWechat}
            aria-label={`${t('home.pewpew.header.wechat')} · ${t('home.pewpew.header.copyWechat')}`}
            sx={(theme) => {
              const light = isLightTheme(theme)
              return {
                height: 40,
                pl: 0.75,
                pr: { xs: 0.75, sm: 1.5 },
                gap: 0.75,
                borderRadius: 999,
                color: 'text.primary',
                bgcolor: {
                  xs: 'transparent',
                  sm: light ? alpha('#ffffff', 0.55) : alpha('#ffffff', 0.06),
                },
                border: {
                  xs: '1px solid transparent',
                  sm: `1px solid ${light ? alpha('#ffffff', 0.85) : alpha('#ffffff', 0.12)}`,
                },
                WebkitBackdropFilter: 'blur(16px) saturate(160%)',
                backdropFilter: 'blur(16px) saturate(160%)',
                boxShadow: {
                  xs: 'none',
                  sm: light
                    ? '0 6px 18px rgba(40, 70, 140, 0.1) !important'
                    : 'none',
                },
                transition: 'background-color 160ms ease',
                '&:hover': {
                  bgcolor: alpha(WECHAT_GREEN, light ? 0.12 : 0.14),
                },
              }
            }}
          >
            <WeChatBadge size={24} />
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                display: { xs: 'none', sm: 'block' },
                whiteSpace: 'nowrap',
              }}
            >
              {t('home.pewpew.header.wechat')}
            </Typography>
          </ButtonBase>
        </Tooltip>

        <Tooltip title={t('home.pewpew.header.preferences')}>
          <Button
            variant="text"
            startIcon={<SettingsRounded />}
            onClick={onPreferences}
            aria-label={t('home.pewpew.header.preferences')}
            sx={headerButtonSx}
          >
            <Box
              component="span"
              sx={{ display: { xs: 'none', sm: 'inline' } }}
            >
              {t('home.pewpew.header.preferences')}
            </Box>
          </Button>
        </Tooltip>

        <Tooltip title={t('home.pewpew.header.about')}>
          <Button
            variant="text"
            startIcon={<InfoOutlined />}
            onClick={onAbout}
            aria-label={t('home.pewpew.header.about')}
            sx={headerButtonSx}
          >
            <Box
              component="span"
              sx={{ display: { xs: 'none', sm: 'inline' } }}
            >
              {t('home.pewpew.header.about')}
            </Box>
          </Button>
        </Tooltip>
      </Stack>
    </Box>
  )
}

const WeChatBadge = ({ size = 24 }: { size?: number }) => (
  <Box
    aria-hidden
    sx={{
      width: size,
      height: size,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: WECHAT_GREEN,
      color: '#fff',
      flexShrink: 0,
    }}
  >
    <WeChatIcon size={Math.round(size * 0.7)} />
  </Box>
)

const WeChatIcon = ({ size = 17 }: { size?: number }) => {
  return (
    <Box
      component="svg"
      viewBox="0 0 32 32"
      aria-hidden="true"
      sx={{ width: size, height: size, display: 'block' }}
    >
      <ellipse cx="13.2" cy="14.2" rx="7.8" ry="5.8" fill="#fff" />
      <path
        d="M8.6 19.1 6.8 22l3.6-1.5c.9.2 1.8.3 2.8.3 4.3 0 7.8-2.6 7.8-5.9S17.5 9 13.2 9s-7.8 2.6-7.8 5.9c0 1.6 1.2 3.1 3.2 4.2Z"
        fill="#fff"
      />
      <ellipse
        cx="19.8"
        cy="18.8"
        rx="6.8"
        ry="5.1"
        fill="#fff"
        opacity="0.92"
      />
      <path
        d="m23.9 22.6 2.9 1.2-1.5-2.4c.8-.8 1.3-1.8 1.3-2.9 0-2.8-3-5.1-6.8-5.1S13 15.7 13 18.5s3 5.1 6.8 5.1c1.5 0 2.9-.4 4.1-1Z"
        fill="#fff"
        opacity="0.92"
      />
      <circle cx="10.6" cy="13.9" r="0.9" fill={WECHAT_GREEN} />
      <circle cx="15.2" cy="13.9" r="0.9" fill={WECHAT_GREEN} />
      <circle cx="17.7" cy="18.4" r="0.75" fill={WECHAT_GREEN} />
      <circle cx="21.4" cy="18.4" r="0.75" fill={WECHAT_GREEN} />
    </Box>
  )
}

export default HomePage
