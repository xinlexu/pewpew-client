import {
  BuildRounded,
  CloseRounded,
  ContentCopyRounded,
  EventAvailableRounded,
  InfoOutlined,
  RestartAltRounded,
  SettingsRounded,
  TravelExploreRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  Paper,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { getVersion } from '@tauri-apps/api/app'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import dayjs from 'dayjs'
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import pewpewLogo from '@/assets/pewpew-logo.jpg'
import { ClashModeCard } from '@/components/home/clash-mode-card'
import { CurrentProxyCard } from '@/components/home/current-proxy-card'
import { HomeProfileCard } from '@/components/home/home-profile-card'
import { ProxyTunCard } from '@/components/home/proxy-tun-card'
import { useI18n } from '@/hooks/use-i18n'
import { useProfiles } from '@/hooks/use-profiles'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import { enhanceProfiles, updateProfile } from '@/services/cmds'
import delayManager from '@/services/delay'
import type { ClientLanguageMode } from '@/services/i18n'
import { getCachedClientLanguageMode } from '@/services/i18n'
import { showNotice } from '@/services/notice-service'
import {
  PEWPEW_LAST_YAML_PROFILE_KEY,
  PEWPEW_UNKNOWN_STATUS,
  PewPewAccountEvaluation,
  PewPewSubscriptionStatus,
  evaluatePewPewAccountState,
  extractPewPewSubscriptionStatus,
  resolvePewPewProxyGroup,
} from '@/utils/pewpew-client'

const PEWPEW_BLUE = '#2869df'
const WECHAT_GREEN = '#07c160'
const AUTO_UPDATE_ROUTES_ON_STARTUP_KEY = 'pewpew-auto-update-routes-on-startup'

const readAutoUpdateRoutesOnStartup = () =>
  localStorage.getItem(AUTO_UPDATE_ROUTES_ON_STARTUP_KEY) !== 'false'

const writeAutoUpdateRoutesOnStartup = (enabled: boolean) => {
  localStorage.setItem(AUTO_UPDATE_ROUTES_ON_STARTUP_KEY, String(enabled))
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
  const { current, mutateProfiles } = useProfiles()
  const { proxies } = useProxiesData()
  const { refreshAll } = useAppRefreshers()
  const { clashConfig } = useClashConfigData()
  const { verge } = useVerge()
  const {
    indicator: connectionEnabled,
    setSystemProxyEnabled,
    invalidateProxyState,
  } = useSystemProxyState()
  const [lineSyncing, setLineSyncing] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [repairingNetwork, setRepairingNetwork] = useState(false)
  const [lastConnectionError, setLastConnectionError] = useState('')
  const [autoUpdateRoutesOnStartup, setAutoUpdateRoutesOnStartup] = useState(
    readAutoUpdateRoutesOnStartup,
  )
  const [, refreshDelaySummary] = useReducer((value: number) => value + 1, 0)
  const subscriptionCardRef = useRef<HTMLDivElement | null>(null)
  const startupUpdateRanRef = useRef(false)
  const subscriptionStatus = extractPewPewSubscriptionStatus(current, proxies)
  const accountEvaluation = useMemo(
    () => evaluatePewPewAccountState(subscriptionStatus),
    [subscriptionStatus],
  )
  const isDark = theme.palette.mode === 'dark'
  const proxyGroupResult = useMemo(
    () => resolvePewPewProxyGroup(proxies),
    [proxies],
  )

  const currentLineSummary = (() => {
    if (lineSyncing) return { name: '', delayText: '' }

    const { group, options } = proxyGroupResult
    if (!group?.now) return { name: '', delayText: '' }

    const currentLine = options.find((item) => item.name === group.now)
    if (!currentLine) return { name: '', delayText: '' }

    const cachedDelay = delayManager.getDelayUpdate(
      currentLine.name,
      group.name,
    )
    const delay =
      cachedDelay && cachedDelay.delay >= 0
        ? cachedDelay.delay
        : delayManager.getDelayFix(currentLine.record, group.name)
    const delayText =
      delay > 0 && delay < 10000
        ? `${delayManager.formatDelay(delay)} ${t('home.pewpew.delay.unit')}`
        : ''

    return { name: currentLine.name, delayText }
  })()
  const hasUsableRoutes = proxyGroupResult.options.length > 0
  const accountBlockedText = getAccountBlockedText(accountEvaluation, t)
  const accountBlockedContinueText = getAccountBlockedContinueText(
    accountEvaluation,
    t,
  )

  const handleDelayUpdated = useCallback(() => {
    refreshDelaySummary()
  }, [])

  const handleRepairNetwork = useCallback(async () => {
    setRepairingNetwork(true)

    try {
      await setSystemProxyEnabled(false)
      await invalidateProxyState()
      setLastConnectionError('')
      showNotice.success(t('home.pewpew.connectionStatus.repairSuccess'))
    } catch (error) {
      console.error('[PewPew] 恢复网络失败:', error)
      setLastConnectionError(getReadableError(error))
      showNotice.error(t('home.pewpew.connectionStatus.repairFailed'))
      throw error
    } finally {
      setRepairingNetwork(false)
    }
  }, [invalidateProxyState, setSystemProxyEnabled, t])

  const handleCopyDiagnostics = useCallback(async () => {
    try {
      const appVersion = await getVersion().catch(() => 'unknown')
      const hasSubscriptionStatus = Object.values(subscriptionStatus).some(
        (value) => value !== PEWPEW_UNKNOWN_STATUS,
      )
      const lastYamlProfileUid = localStorage.getItem(
        PEWPEW_LAST_YAML_PROFILE_KEY,
      )
      const diagnostics = [
        'PewPew Cloud Client Diagnostics',
        `Version: ${appVersion}`,
        `OS: ${navigator.platform || 'unknown'} (${navigator.userAgent || 'unknown'})`,
        `Language: ${i18n.language || 'unknown'}`,
        `Theme: ${verge?.theme_mode ?? theme.palette.mode}`,
        `Connection: ${connectionEnabled ? 'connected' : 'disconnected'}`,
        `Current route: ${currentLineSummary.name || 'not selected'}`,
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

      try {
        await writeText(diagnostics)
      } catch {
        await navigator.clipboard.writeText(diagnostics)
      }

      showNotice.success(t('home.pewpew.diagnostics.copySuccess'))
    } catch (error) {
      console.error('[PewPew] 复制诊断信息失败:', error)
      showNotice.error(t('home.pewpew.diagnostics.copyFailed'))
    }
  }, [
    clashConfig?.mode,
    connectionEnabled,
    current,
    currentLineSummary.name,
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

  const handleImportGuide = useCallback(() => {
    subscriptionCardRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }, [])

  useEffect(() => {
    if (startupUpdateRanRef.current) return
    if (!autoUpdateRoutesOnStartup || !current?.uid) return
    if (connectionEnabled || lineSyncing) {
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
    lineSyncing,
    mutateProfiles,
    refreshAll,
    t,
  ])

  return (
    <Box
      className="pewpew-shell"
      data-pewpew-theme={isDark ? 'dark' : 'light'}
      sx={{
        '--pewpew-bg': isDark ? '#151922' : '#f4f7fb',
        '--pewpew-panel': isDark
          ? alpha(theme.palette.background.paper, 0.9)
          : alpha(theme.palette.common.white, 0.92),
        '--pewpew-panel-soft': isDark
          ? alpha(theme.palette.background.paper, 0.84)
          : alpha(theme.palette.common.white, 0.84),
        '--pewpew-panel-muted': isDark
          ? alpha(theme.palette.background.paper, 0.78)
          : alpha(theme.palette.common.white, 0.72),
        '--pewpew-border': alpha(PEWPEW_BLUE, isDark ? 0.14 : 0.08),
        '--pewpew-primary-soft': alpha(PEWPEW_BLUE, isDark ? 0.16 : 0.075),
        '--pewpew-input-bg': isDark
          ? alpha(theme.palette.background.paper, 0.72)
          : alpha(theme.palette.common.white, 0.92),
        position: 'relative',
        isolation: 'isolate',
        height: '100%',
        minHeight: '100%',
        overflow: 'auto',
        overflowX: 'hidden',
        boxSizing: 'border-box',
        px: { xs: 2, md: 3 },
        py: { xs: 1.5, md: 2 },
        bgcolor: 'var(--pewpew-bg)',
        '&::before, &::after': {
          content: '""',
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          transition: 'opacity 320ms ease',
        },
        '&::before': {
          zIndex: -2,
          opacity: isDark ? 0 : 1,
          background:
            'radial-gradient(circle at 50% -12%, rgba(40,105,223,0.16), transparent 34%), linear-gradient(145deg, #f4f7fb 0%, #eef5fb 48%, #f8fafc 100%)',
        },
        '&::after': {
          zIndex: -1,
          opacity: isDark ? 1 : 0,
          background:
            'radial-gradient(circle at 50% -10%, rgba(40,105,223,0.22), transparent 32%), linear-gradient(145deg, #151922 0%, #1d2430 52%, #171b24 100%)',
        },
        '&, & .pewpew-transition': {
          transition:
            'background-color 280ms ease, color 240ms ease, border-color 280ms ease, box-shadow 280ms ease, opacity 240ms ease',
        },
        '@media (prefers-reduced-motion: reduce)': {
          '&, & .pewpew-transition, &::before, &::after': {
            transition: 'none !important',
          },
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
          maxWidth: 1080,
          mx: 'auto',
          pb: 3,
          boxSizing: 'border-box',
        }}
      >
        <PewPewHeader
          onAbout={() => setAboutOpen(true)}
          onPreferences={() => setPreferencesOpen(true)}
        />

        <MainConnectPanel
          currentLine={currentLineSummary}
          accountBlockedContinueText={accountBlockedContinueText}
          accountEvaluation={accountEvaluation}
          accountBlockedText={accountBlockedText}
          disabled={lineSyncing}
          hasRoute={hasUsableRoutes}
          onConnectionError={setLastConnectionError}
          onCopyDiagnostics={handleCopyDiagnostics}
          onRepairNetwork={handleRepairNetwork}
          repairing={repairingNetwork}
          status={subscriptionStatus}
        />

        {!hasUsableRoutes && !accountEvaluation.blocked && (
          <GettingStartedCard onImportRoutes={handleImportGuide} />
        )}

        <ConnectionSettingsCard
          accountEvaluation={accountEvaluation}
          accountBlockedText={accountBlockedText}
          onDelayUpdated={handleDelayUpdated}
        />

        <Box ref={subscriptionCardRef}>
          <HomeProfileCard
            current={current}
            onProfileUpdated={mutateProfiles}
            onSyncingChange={setLineSyncing}
          />
        </Box>
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
}: {
  onAbout: () => void
  onPreferences: () => void
}) => {
  const { t } = useTranslation()

  return (
    <Box
      component="header"
      data-tauri-drag-region="true"
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'center' },
        justifyContent: 'space-between',
        gap: 1.5,
        minHeight: 58,
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
          alt="PewPew 云"
          data-tauri-drag-region="false"
          sx={{
            width: { xs: 54, sm: 58 },
            height: { xs: 54, sm: 58 },
            objectFit: 'cover',
            objectPosition: 'center',
            borderRadius: 2.5,
            flexShrink: 0,
          }}
        />

        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 900,
              lineHeight: 1.12,
              fontSize: { xs: 20, sm: 24 },
            }}
          >
            {t('home.pewpew.header.title')}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.35, fontWeight: 600 }}
          >
            {t('home.pewpew.header.subtitle')}
          </Typography>
        </Box>
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        data-tauri-drag-region="false"
        sx={{
          alignItems: 'center',
          justifyContent: { xs: 'space-between', sm: 'flex-end' },
          flexShrink: 0,
          flexWrap: 'wrap',
          width: { xs: '100%', sm: 'auto' },
        }}
      >
        <Stack
          direction="row"
          spacing={0.75}
          sx={(theme) => ({
            alignItems: 'center',
            px: 1.1,
            py: 0.65,
            borderRadius: 999,
            color: theme.palette.text.primary,
            bgcolor:
              theme.palette.mode === 'light'
                ? alpha(theme.palette.common.white, 0.78)
                : alpha(theme.palette.common.white, 0.08),
            border: `1px solid ${alpha(WECHAT_GREEN, 0.2)}`,
          })}
        >
          <Box
            sx={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: WECHAT_GREEN,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            <WeChatIcon />
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 800 }}>
            {t('home.pewpew.header.wechat')}
          </Typography>
        </Stack>

        <Button
          size="small"
          variant="text"
          color="inherit"
          startIcon={<SettingsRounded />}
          onClick={onPreferences}
          sx={{ borderRadius: 999, px: 1.15, fontWeight: 700 }}
        >
          {t('home.pewpew.header.preferences')}
        </Button>

        <Button
          size="small"
          variant="text"
          color="inherit"
          startIcon={<InfoOutlined />}
          onClick={onAbout}
          sx={{ borderRadius: 999, px: 1.15, fontWeight: 700 }}
        >
          {t('home.pewpew.header.about')}
        </Button>
      </Stack>
    </Box>
  )
}

const WeChatIcon = () => {
  return (
    <Box
      component="svg"
      viewBox="0 0 32 32"
      aria-hidden="true"
      sx={{ width: 17, height: 17, display: 'block' }}
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

const MainConnectPanel = ({
  accountBlockedContinueText,
  accountBlockedText,
  accountEvaluation,
  currentLine,
  disabled,
  hasRoute,
  onConnectionError,
  onCopyDiagnostics,
  onRepairNetwork,
  repairing,
  status,
}: {
  accountBlockedContinueText: string
  accountBlockedText: string
  accountEvaluation: PewPewAccountEvaluation
  currentLine: { name: string; delayText: string }
  disabled: boolean
  hasRoute: boolean
  onConnectionError: (message: string) => void
  onCopyDiagnostics: () => Promise<void>
  onRepairNetwork: () => Promise<void>
  repairing: boolean
  status: PewPewSubscriptionStatus
}) => {
  return (
    <Paper
      className="pewpew-transition"
      elevation={0}
      sx={(theme) => ({
        borderRadius: 5,
        px: { xs: 2, md: 3 },
        py: { xs: 2.25, md: 3 },
        boxSizing: 'border-box',
        overflow: 'hidden',
        bgcolor: 'var(--pewpew-panel)',
        border: `1px solid ${alpha(PEWPEW_BLUE, 0.1)}`,
        boxShadow:
          theme.palette.mode === 'light'
            ? '0 26px 80px rgba(40, 70, 120, 0.14)'
            : '0 26px 80px rgba(0, 0, 0, 0.28)',
      })}
    >
      <Stack spacing={2} sx={{ alignItems: 'center', minWidth: 0 }}>
        <Box sx={{ width: '100%', maxWidth: 440 }}>
          <ProxyTunCard
            connectionBlocked={accountEvaluation.blocked}
            connectionBlockedText={accountBlockedContinueText}
            disabled={disabled}
            hasRoute={hasRoute}
            onConnectionError={onConnectionError}
            onCopyDiagnostics={onCopyDiagnostics}
            onRepairNetwork={onRepairNetwork}
            repairing={repairing}
          />
        </Box>

        <LineSummaryChip
          accountEvaluation={accountEvaluation}
          blockedText={accountBlockedText}
          currentLine={currentLine}
        />

        <SubscriptionStatusCard
          accountEvaluation={accountEvaluation}
          status={status}
        />
      </Stack>
    </Paper>
  )
}

const LineSummaryChip = ({
  accountEvaluation,
  blockedText,
  currentLine,
}: {
  accountEvaluation: PewPewAccountEvaluation
  blockedText: string
  currentLine: { name: string; delayText: string }
}) => {
  const { t } = useTranslation()
  const text = accountEvaluation.blocked
    ? blockedText
    : !currentLine.name
      ? t('home.pewpew.switch.currentRouteEmpty')
      : currentLine.delayText
        ? t('home.pewpew.switch.currentRouteWithDelay', {
            name: currentLine.name,
            delay: currentLine.delayText,
          })
        : t('home.pewpew.switch.currentRoute', { name: currentLine.name })

  return (
    <Box
      sx={(theme) => ({
        maxWidth: '100%',
        px: 1.6,
        py: 0.8,
        borderRadius: 999,
        boxSizing: 'border-box',
        color: theme.palette.text.primary,
        bgcolor:
          theme.palette.mode === 'light'
            ? alpha(
                accountEvaluation.blocked
                  ? theme.palette.error.main
                  : PEWPEW_BLUE,
                0.075,
              )
            : alpha(
                accountEvaluation.blocked
                  ? theme.palette.error.main
                  : PEWPEW_BLUE,
                0.16,
              ),
        border: `1px solid ${alpha(
          accountEvaluation.blocked ? theme.palette.error.main : PEWPEW_BLUE,
          0.14,
        )}`,
      })}
    >
      <Typography
        variant="body2"
        sx={{
          fontWeight: 800,
          textAlign: 'center',
          overflowWrap: 'anywhere',
        }}
      >
        {text}
      </Typography>
    </Box>
  )
}

const SubscriptionStatusCard = ({
  accountEvaluation,
  status,
}: {
  accountEvaluation: PewPewAccountEvaluation
  status: PewPewSubscriptionStatus
}) => {
  const { i18n, t } = useTranslation()
  const alert =
    accountEvaluation.state === 'expired'
      ? {
          severity: 'error' as const,
          key: 'home.pewpew.account.planExpiredContinue',
        }
      : accountEvaluation.state === 'dataExhausted'
        ? {
            severity: 'error' as const,
            key: 'home.pewpew.account.dataExhaustedContinue',
          }
        : accountEvaluation.state === 'expiringSoon'
          ? {
              severity: 'warning' as const,
              key: 'home.pewpew.account.expiringSoon',
            }
          : accountEvaluation.state === 'dataLow'
            ? {
                severity: 'warning' as const,
                key: 'home.pewpew.account.lowData',
              }
            : null
  const formatStatusValue = (value: string) => {
    if (value === PEWPEW_UNKNOWN_STATUS) {
      return t('home.pewpew.account.unavailable')
    }
    if (/(?:长期有效|lifetime|unlimited)/i.test(value)) {
      return t('home.pewpew.account.lifetime')
    }
    if (i18n.language === 'en') {
      return value.replace(/^(\d+)\s*天$/, (_, days) => `${days} days`)
    }
    return value
  }
  const items = [
    {
      label: t('home.pewpew.account.remainingTraffic'),
      value: formatStatusValue(status.remainingTraffic),
      icon: <TravelExploreRounded fontSize="small" />,
    },
    {
      label: t('home.pewpew.account.nextReset'),
      value: formatStatusValue(status.nextReset),
      icon: <RestartAltRounded fontSize="small" />,
    },
    {
      label: t('home.pewpew.account.expire'),
      value: formatStatusValue(status.expire),
      icon: <EventAvailableRounded fontSize="small" />,
    },
  ]

  return (
    <Stack
      spacing={1.25}
      sx={{
        width: '100%',
        maxWidth: 760,
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{ fontWeight: 850, textAlign: 'center' }}
      >
        {t('home.pewpew.account.title')}
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(3, minmax(0, 1fr))',
          },
          gap: 1,
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        {items.map((item) => (
          <Box
            key={item.label}
            sx={(theme) => ({
              minHeight: 82,
              minWidth: 0,
              borderRadius: 3,
              border: `1px solid ${alpha(PEWPEW_BLUE, 0.09)}`,
              px: 1.45,
              py: 1.2,
              boxSizing: 'border-box',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 0.65,
              bgcolor:
                theme.palette.mode === 'light'
                  ? alpha(PEWPEW_BLUE, 0.04)
                  : alpha(PEWPEW_BLUE, 0.12),
            })}
          >
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: 'center', minWidth: 0 }}
            >
              <Box sx={{ color: PEWPEW_BLUE, display: 'flex' }}>
                {item.icon}
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 750 }}
              >
                {item.label}
              </Typography>
            </Stack>
            <Typography
              sx={{
                fontSize: { xs: 17, sm: 18 },
                fontWeight: 900,
                lineHeight: 1.18,
                overflowWrap: 'anywhere',
              }}
            >
              {item.value}
            </Typography>
          </Box>
        ))}
      </Box>

      {alert && (
        <Alert
          key={alert.key}
          severity={alert.severity}
          variant="outlined"
          sx={{ borderRadius: 3, py: 0.35, alignItems: 'center' }}
        >
          {t(alert.key)}
        </Alert>
      )}
    </Stack>
  )
}

const GettingStartedCard = ({
  onImportRoutes,
}: {
  onImportRoutes: () => void
}) => {
  const { t } = useTranslation()
  const steps = [
    t('home.pewpew.onboarding.stepPaste'),
    t('home.pewpew.onboarding.stepImport'),
    t('home.pewpew.onboarding.stepConnect'),
  ]

  return (
    <Paper
      className="pewpew-transition"
      elevation={0}
      sx={(theme) => ({
        borderRadius: 4,
        p: { xs: 2, md: 2.35 },
        bgcolor:
          theme.palette.mode === 'light'
            ? alpha(PEWPEW_BLUE, 0.055)
            : alpha(PEWPEW_BLUE, 0.13),
        border: `1px solid ${alpha(PEWPEW_BLUE, 0.12)}`,
        boxSizing: 'border-box',
      })}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{
          alignItems: { xs: 'stretch', md: 'center' },
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 850, mb: 0.75 }}>
            {t('home.pewpew.onboarding.title')}
          </Typography>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ flexWrap: 'wrap' }}
          >
            {steps.map((step, index) => (
              <Typography
                key={step}
                variant="body2"
                color="text.secondary"
                sx={{ fontWeight: 700 }}
              >
                {index + 1}. {step}
              </Typography>
            ))}
          </Stack>
        </Box>
        <Button
          variant="contained"
          onClick={onImportRoutes}
          sx={{ borderRadius: 999, fontWeight: 850, flexShrink: 0 }}
        >
          {t('home.pewpew.onboarding.importRoutes')}
        </Button>
      </Stack>
    </Paper>
  )
}

const ConnectionSettingsCard = ({
  accountBlockedText,
  accountEvaluation,
  onDelayUpdated,
}: {
  accountBlockedText: string
  accountEvaluation: PewPewAccountEvaluation
  onDelayUpdated: () => void
}) => {
  const { t } = useTranslation()

  return (
    <Paper
      className="pewpew-transition"
      elevation={0}
      sx={(theme) => ({
        borderRadius: 4,
        p: { xs: 2, md: 2.5 },
        boxSizing: 'border-box',
        overflow: 'hidden',
        bgcolor: 'var(--pewpew-panel-soft)',
        border: `1px solid ${alpha(PEWPEW_BLUE, 0.08)}`,
        boxShadow:
          theme.palette.mode === 'light'
            ? '0 14px 38px rgba(40, 70, 120, 0.07)'
            : '0 14px 38px rgba(0, 0, 0, 0.2)',
      })}
    >
      <Stack spacing={1.75}>
        <Typography variant="h6" sx={{ fontWeight: 850 }}>
          {t('home.pewpew.connection.title')}
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md: 'minmax(0, 1.2fr) minmax(360px, 0.8fr)',
            },
            gap: 2.25,
            minWidth: 0,
            alignItems: 'stretch',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <CurrentProxyCard
              embedded
              routeBlocked={accountEvaluation.blocked}
              routeBlockedText={accountBlockedText}
              onDelayUpdated={onDelayUpdated}
            />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Stack spacing={1} sx={{ height: '100%' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>
                {t('home.pewpew.connection.mode')}
              </Typography>
              <ClashModeCard />
            </Stack>
          </Box>
        </Box>
      </Stack>
    </Paper>
  )
}

type PreferencePatch = Pick<
  IVergeConfig,
  | 'theme_mode'
  | 'enable_auto_launch'
  | 'enable_silent_start'
  | 'enable_system_proxy'
  | 'auto_close_connection'
>

const PreferencesDialog = ({
  autoUpdateRoutesOnStartup,
  open,
  onClose,
  onAutoUpdateRoutesOnStartupChange,
  onCopyDiagnostics,
  onRepairNetwork,
  repairingNetwork,
}: {
  autoUpdateRoutesOnStartup: boolean
  open: boolean
  onClose: () => void
  onAutoUpdateRoutesOnStartupChange: (enabled: boolean) => void
  onCopyDiagnostics: () => Promise<void>
  onRepairNetwork: () => Promise<void>
  repairingNetwork: boolean
}) => {
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { current } = useProfiles()
  const { switchClientLanguageMode, isLoading: languageLoading } = useI18n()
  const [languageMode, setLanguageMode] = useState<ClientLanguageMode>(
    () => getCachedClientLanguageMode() ?? 'system',
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      queueMicrotask(() =>
        setLanguageMode(getCachedClientLanguageMode() ?? 'system'),
      )
    }
  }, [open])

  const updatePreference = async (patch: Partial<PreferencePatch>) => {
    setSaving(true)
    mutateVerge((prev) => (prev ? { ...prev, ...patch } : prev), false)

    try {
      await patchVerge(patch)
    } catch (error) {
      console.error('[PewPew] 偏好设置保存失败:', error)
      showNotice.error(t('home.pewpew.preferences.saveFailed'))
      mutateVerge()
    } finally {
      setSaving(false)
    }
  }

  const handleThemeModeChange = (_event: unknown, value: string | null) => {
    if (!value) return
    void updatePreference({
      theme_mode: value as NonNullable<IVergeConfig['theme_mode']>,
    })
  }

  const handleLanguageModeChange = async (
    _event: unknown,
    value: ClientLanguageMode | null,
  ) => {
    if (!value) return
    const previous = languageMode
    setLanguageMode(value)

    try {
      await switchClientLanguageMode(value)
    } catch {
      setLanguageMode(previous)
      showNotice.error(t('home.pewpew.preferences.saveFailed'))
    }
  }

  const preferenceDisabled = saving || languageLoading
  const themeMode = verge?.theme_mode ?? 'system'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 4,
            transition:
              'background-color 280ms ease, color 240ms ease, border-color 280ms ease, box-shadow 280ms ease',
          },
        },
      }}
    >
      <DialogTitle sx={{ pr: 6, fontWeight: 850 }}>
        {t('home.pewpew.preferences.title')}
        <IconButton
          aria-label={t('home.pewpew.about.close')}
          onClick={onClose}
          sx={{ position: 'absolute', right: 12, top: 10 }}
        >
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.25}>
          <PreferenceSection title={t('home.pewpew.preferences.appearance')}>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              value={themeMode}
              onChange={handleThemeModeChange}
              disabled={preferenceDisabled}
              sx={preferenceControlSx}
            >
              <ToggleButton value="system">
                {t('home.pewpew.preferences.followSystem')}
              </ToggleButton>
              <ToggleButton value="light">
                {t('home.pewpew.preferences.light')}
              </ToggleButton>
              <ToggleButton value="dark">
                {t('home.pewpew.preferences.dark')}
              </ToggleButton>
            </ToggleButtonGroup>
          </PreferenceSection>

          <PreferenceSection title={t('home.pewpew.preferences.language')}>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              value={languageMode}
              onChange={handleLanguageModeChange}
              disabled={preferenceDisabled}
              sx={preferenceControlSx}
            >
              <ToggleButton value="system">
                {t('home.pewpew.preferences.followSystem')}
              </ToggleButton>
              <ToggleButton value="zh-CN">
                {t('home.pewpew.preferences.simplifiedChinese')}
              </ToggleButton>
              <ToggleButton value="en-US">
                {t('home.pewpew.preferences.english')}
              </ToggleButton>
            </ToggleButtonGroup>
          </PreferenceSection>

          <PreferenceSection title={t('home.pewpew.preferences.startup')}>
            <Stack spacing={0.25}>
              <PreferenceSwitch
                label={t('home.pewpew.preferences.autoLaunch')}
                checked={verge?.enable_auto_launch ?? false}
                disabled={preferenceDisabled}
                onChange={(checked) =>
                  void updatePreference({ enable_auto_launch: checked })
                }
              />
              <PreferenceSwitch
                label={t('home.pewpew.preferences.silentStart')}
                checked={verge?.enable_silent_start ?? false}
                disabled={preferenceDisabled}
                onChange={(checked) =>
                  void updatePreference({ enable_silent_start: checked })
                }
              />
              <PreferenceSwitch
                label={t('home.pewpew.preferences.autoUpdateRoutesOnStartup')}
                checked={autoUpdateRoutesOnStartup}
                disabled={preferenceDisabled}
                onChange={onAutoUpdateRoutesOnStartupChange}
              />
              <PreferenceSwitch
                label={t('home.pewpew.preferences.autoStartPewPew')}
                checked={verge?.enable_system_proxy ?? false}
                disabled={preferenceDisabled}
                onChange={(checked) => {
                  if (checked && !current?.uid) {
                    showNotice.error(t('home.pewpew.connection.importFirst'))
                    return
                  }
                  void updatePreference({ enable_system_proxy: checked })
                }}
              />
            </Stack>
          </PreferenceSection>

          <PreferenceSection title={t('home.pewpew.preferences.safety')}>
            <PreferenceSwitch
              label={t('home.pewpew.preferences.autoCloseOnQuit')}
              checked={verge?.auto_close_connection ?? true}
              disabled={preferenceDisabled}
              onChange={(checked) =>
                void updatePreference({ auto_close_connection: checked })
              }
            />
          </PreferenceSection>

          <Divider />

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ justifyContent: 'flex-end' }}
          >
            <Button
              variant="outlined"
              onClick={() => void onRepairNetwork()}
              disabled={preferenceDisabled || repairingNetwork}
              startIcon={<BuildRounded />}
              sx={{ borderRadius: 999, fontWeight: 800 }}
            >
              {t('home.pewpew.connectionStatus.repairNetwork')}
            </Button>
            <Button
              variant="text"
              onClick={() => void onCopyDiagnostics()}
              startIcon={<ContentCopyRounded />}
              sx={{ borderRadius: 999, fontWeight: 800 }}
            >
              {t('home.pewpew.diagnostics.copy')}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ borderRadius: 999, fontWeight: 800 }}>
          {t('home.pewpew.about.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const preferenceControlSx = (theme: Theme) => ({
  p: 0.35,
  borderRadius: 2.5,
  bgcolor:
    theme.palette.mode === 'light'
      ? alpha(theme.palette.common.white, 0.74)
      : alpha(theme.palette.common.white, 0.06),
  border: `1px solid ${
    theme.palette.mode === 'light'
      ? alpha(theme.palette.grey[900], 0.12)
      : alpha(theme.palette.common.white, 0.1)
  }`,
  '& .MuiToggleButton-root': {
    minHeight: 38,
    textTransform: 'none',
    fontWeight: 800,
    px: 1,
    whiteSpace: 'normal',
    lineHeight: 1.2,
    border: 0,
    borderRadius: '10px !important',
    color: theme.palette.text.secondary,
    '&.Mui-selected': {
      bgcolor:
        theme.palette.mode === 'light'
          ? alpha(PEWPEW_BLUE, 0.12)
          : alpha(PEWPEW_BLUE, 0.28),
      color: theme.palette.mode === 'light' ? PEWPEW_BLUE : '#dbeafe',
    },
    '&.Mui-selected:hover': {
      bgcolor:
        theme.palette.mode === 'light'
          ? alpha(PEWPEW_BLUE, 0.16)
          : alpha(PEWPEW_BLUE, 0.34),
    },
  },
})

const PreferenceSection = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) => {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
        {title}
      </Typography>
      {children}
    </Stack>
  )
}

const PreferenceSwitch = ({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) => {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 2,
        alignItems: 'center',
        minHeight: 42,
        minWidth: 0,
      }}
    >
      <Typography
        variant="body2"
        sx={{
          fontWeight: 650,
          minWidth: 0,
          overflowWrap: 'anywhere',
        }}
      >
        {label}
      </Typography>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        sx={pewpewSwitchSx}
      />
    </Box>
  )
}

const pewpewSwitchSx = {
  width: 48,
  height: 30,
  p: 0.75,
  flexShrink: 0,
  '& .MuiSwitch-switchBase': {
    p: 0.75,
    transitionDuration: '220ms',
    '&.Mui-checked': {
      transform: 'translateX(18px)',
      color: '#fff',
      '& + .MuiSwitch-track': {
        bgcolor: '#2f7dff',
        opacity: 1,
      },
      '& .MuiSwitch-thumb': {
        borderColor: 'rgba(255,255,255,0.72)',
      },
    },
    '&.Mui-disabled': {
      color: '#9ca3af',
      '& + .MuiSwitch-track': {
        opacity: 1,
        bgcolor: (theme: Theme) =>
          theme.palette.mode === 'light' ? '#e5e7eb' : 'rgba(255,255,255,0.12)',
      },
      '& .MuiSwitch-thumb': {
        borderColor: 'rgba(148,163,184,0.45)',
      },
    },
  },
  '& .MuiSwitch-thumb': {
    width: 18,
    height: 18,
    bgcolor: '#fff',
    border: '1px solid rgba(15,23,42,0.25)',
    boxShadow: '0 2px 8px rgba(15,23,42,0.18)',
  },
  '& .MuiSwitch-track': {
    borderRadius: 999,
    opacity: 1,
    bgcolor: (theme: Theme) =>
      theme.palette.mode === 'light' ? '#cbd5e1' : 'rgba(255,255,255,0.22)',
  },
}

const AboutDialog = ({
  open,
  onClose,
  onCopyDiagnostics,
}: {
  open: boolean
  onClose: () => void
  onCopyDiagnostics: () => Promise<void>
}) => {
  const { t } = useTranslation()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 4,
            transition:
              'background-color 280ms ease, color 240ms ease, border-color 280ms ease, box-shadow 280ms ease',
          },
        },
      }}
    >
      <DialogTitle sx={{ pr: 6, fontWeight: 850 }}>
        {t('home.pewpew.about.title')}
        <IconButton
          aria-label={t('home.pewpew.about.close')}
          onClick={onClose}
          sx={{ position: 'absolute', right: 12, top: 10 }}
        >
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              {t('home.pewpew.about.clientName')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('home.pewpew.about.description')}
            </Typography>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              {t('home.pewpew.about.licenseTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('home.pewpew.about.license')}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              {t('home.pewpew.about.credits')}
            </Typography>
            <Stack spacing={0.5}>
              <Link
                href="https://github.com/clash-verge-rev/clash-verge-rev"
                target="_blank"
                rel="noreferrer"
                underline="hover"
              >
                Clash Verge Rev
              </Link>
              <Link
                href="https://github.com/MetaCubeX/mihomo"
                target="_blank"
                rel="noreferrer"
                underline="hover"
              >
                mihomo / Clash.Meta
              </Link>
              <Link
                href="https://tauri.app/"
                target="_blank"
                rel="noreferrer"
                underline="hover"
              >
                Tauri
              </Link>
            </Stack>
          </Box>

          <Typography variant="caption" color="text.secondary">
            {t('home.pewpew.about.support')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          onClick={() => void onCopyDiagnostics()}
          startIcon={<ContentCopyRounded />}
          sx={{ borderRadius: 999, fontWeight: 800, mr: 'auto' }}
        >
          {t('home.pewpew.diagnostics.copy')}
        </Button>
        <Button onClick={onClose} sx={{ borderRadius: 999, fontWeight: 800 }}>
          {t('home.pewpew.about.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default HomePage
