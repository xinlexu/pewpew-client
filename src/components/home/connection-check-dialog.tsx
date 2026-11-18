import {
  CheckCircleRounded,
  ContentCopyRounded,
  ErrorRounded,
  HelpOutlineRounded,
  InfoRounded,
  RefreshRounded,
  RemoveCircleOutlineRounded,
  WarningAmberRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
  keyframes,
  useTheme,
} from '@mui/material'
import dayjs from 'dayjs'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  copyToClipboard,
  dialogBackdropSx,
  dialogPaperSx,
  hairlineColor,
  pillButtonSx,
  reducedMotion,
  sectionLabelSx,
} from '@/components/home/pewpew-ui'
import { useClashModeChange } from '@/hooks/use-clash-mode-change'
import { useFastestRoute } from '@/hooks/use-fastest-route'
import { getIpInfo } from '@/services/api'
import {
  calcuProxies,
  cmdTestDelay,
  detectProxyConflicts,
  getDiscordProbeStatus,
  isServiceAvailable,
  type DiscordProbeStatus,
} from '@/services/cmds'
import { readConnectionState } from '@/services/connection'
import delayManager from '@/services/delay'
import { showNotice } from '@/services/notice-service'
import {
  configuredMixedPort,
  isProxyPortOpen,
} from '@/services/proxy-conflicts'
import {
  DOMESTIC_SLOW_MS,
  DOMESTIC_TEST_URL,
  FOREIGN_SLOW_MS,
  FOREIGN_TEST_URL,
  judgeConnection,
  timedStatus,
  type CheckAction,
  type CheckStatus,
  type CheckVerdict,
} from '@/utils/connection-check'
import type { ConnectionMode } from '@/utils/connection-state'
import { resolvePewPewProxyGroup } from '@/utils/pewpew-client'
import { isUsableDelay, regionFlag, regionName } from '@/utils/route-health'

const ROUTE_TEST_TIMEOUT = 5000
// The exit lookup tries several public services; past this it is skipped.
const EXIT_LOOKUP_TIMEOUT = 6000
// A route answering slower than this still works but feels sluggish.
const ROUTE_SLOW_MS = 800

type Timed = { running: boolean; ms: number | null }
type ExitInfo = { code: string; country: string; org: string }

type LocalFacts = {
  core: boolean
  port: number
  portOpen: boolean
  systemProxy: boolean
  tun: boolean
  clashMode: string
  service: boolean
  otherApps: string[] | null
  discord: DiscordProbeStatus | null
}

type CheckRun = {
  local: LocalFacts | null
  localFailed: boolean
  // Network checks only run while connected.
  network: boolean
  route: Timed & { name: string | null }
  domestic: Timed
  foreign: Timed
  exit: { running: boolean; info: ExitInfo | null }
  done: boolean
}

const idle = (): CheckRun => ({
  local: null,
  localFailed: false,
  network: false,
  route: { running: false, ms: null, name: null },
  domestic: { running: false, ms: null },
  foreign: { running: false, ms: null },
  exit: { running: false, info: null },
  done: false,
})

const rowIn = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
`

interface ConnectionCheckDialogProps {
  open: boolean
  onClose: () => void
  // The client is set to be connected.
  connected: boolean
  mode: ConnectionMode
  busy: boolean
  udp?: boolean
  onRepair?: () => Promise<void>
  onSwitchEnhanced?: () => void
  buildDiagnostics?: () => Promise<string>
}

export const ConnectionCheckDialog = ({
  open,
  onClose,
  connected,
  mode,
  busy,
  udp,
  onRepair,
  onSwitchEnhanced,
  buildDiagnostics,
}: ConnectionCheckDialogProps) => {
  const theme = useTheme()
  const { t, i18n } = useTranslation()
  const [run, setRun] = useState<CheckRun>(idle)
  const [acting, setActing] = useState(false)
  const runRef = useRef(0)
  const switchToFastest = useFastestRoute()
  const { mutateAsync: changeMode } = useClashModeChange()

  const start = useCallback(async () => {
    const id = ++runRef.current
    const current = () => id === runRef.current
    const update = (patch: (prev: CheckRun) => CheckRun) => {
      if (current()) setRun(patch)
    }
    setRun(idle())

    let local: LocalFacts
    try {
      const [state, service, conflicts, discord] = await Promise.all([
        readConnectionState(),
        isServiceAvailable().catch(() => false),
        detectProxyConflicts().catch(() => null),
        getDiscordProbeStatus().catch(() => null),
      ])
      local = {
        core: !!state.config,
        port: configuredMixedPort(state.settings, state.config),
        portOpen: isProxyPortOpen(state.config),
        systemProxy: state.systemProxy,
        tun: state.tun,
        clashMode: state.config?.mode?.toLowerCase() ?? 'rule',
        service,
        otherApps: conflicts?.apps ?? null,
        discord,
      }
    } catch {
      update((prev) => ({ ...prev, localFailed: true, done: true }))
      return
    }

    const network = connected && local.core && local.portOpen
    update((prev) => ({
      ...prev,
      local,
      network,
      route: { ...prev.route, running: network },
      domestic: { running: network, ms: null },
      foreign: { running: network, ms: null },
      exit: { running: network, info: null },
      done: !network,
    }))
    if (!network) return

    const routeCheck = (async () => {
      const proxies = await calcuProxies()
      const { group, currentName } = resolvePewPewProxyGroup(
        proxies,
        local.clashMode,
      )
      if (!group || !currentName) return { name: null, ms: null }
      update((prev) => ({
        ...prev,
        route: { ...prev.route, name: currentName },
      }))
      const result = await delayManager.checkDelay(
        currentName,
        group.name,
        ROUTE_TEST_TIMEOUT,
      )
      return { name: currentName, ms: result.delay }
    })()
      .catch(() => ({ name: null, ms: null }))
      .then((route) =>
        update((prev) => ({ ...prev, route: { running: false, ...route } })),
      )
    const site = (url: string, key: 'domestic' | 'foreign') =>
      cmdTestDelay(url)
        .catch(() => 10000)
        .then((ms) =>
          update((prev) => ({ ...prev, [key]: { running: false, ms } })),
        )
    // The exit location is extra detail: it never holds up the verdict.
    void Promise.race([
      getIpInfo(),
      new Promise<never>((_, reject) =>
        window.setTimeout(
          () => reject(new Error('timeout')),
          EXIT_LOOKUP_TIMEOUT,
        ),
      ),
    ])
      .then(
        (info): ExitInfo => ({
          code: info.country_code?.toUpperCase() ?? '',
          country: info.country ?? '',
          org: info.asn_organization || info.organization || '',
        }),
      )
      .catch(() => null)
      .then((info) =>
        update((prev) => ({ ...prev, exit: { running: false, info } })),
      )

    await Promise.allSettled([
      routeCheck,
      site(DOMESTIC_TEST_URL, 'domestic'),
      site(FOREIGN_TEST_URL, 'foreign'),
    ])
    update((prev) => ({ ...prev, done: true }))
  }, [connected])

  useEffect(() => {
    if (open) queueMicrotask(() => void start())
    else runRef.current += 1
  }, [open, start])

  const local = run.local
  const verdict: CheckVerdict | null =
    run.done && local
      ? judgeConnection({
          connected,
          mode,
          clashMode: local.clashMode,
          core: local.core,
          portOpen: local.portOpen,
          systemProxy: local.systemProxy,
          tun: local.tun,
          otherApps: local.otherApps,
          route: run.route.name,
          routeDelay: run.network ? run.route.ms : null,
          domestic: run.network ? run.domestic.ms : null,
          foreign: run.network ? run.foreign.ms : null,
        })
      : null

  const act = async (action: CheckAction) => {
    if (!action || acting) return
    setActing(true)
    try {
      if (action === 'repair') {
        await onRepair?.()
      } else if (action === 'smartMode') {
        await changeMode('rule')
      } else if (action === 'fastestRoute') {
        const result = await switchToFastest()
        if (result.status === 'switched') {
          showNotice.success(
            t('home.pewpew.check.switched', {
              name: result.to,
              delay: result.delay,
            }),
          )
        } else {
          showNotice.error(
            t(
              result.status === 'allDown'
                ? 'home.pewpew.failover.allDown'
                : 'home.pewpew.connection.routeChangeFailed',
            ),
          )
        }
      }
    } catch {
      // The action reported its own failure.
    } finally {
      setActing(false)
    }
    void start()
  }

  const copyReport = async () => {
    try {
      const base = buildDiagnostics ? await buildDiagnostics() : ''
      const lines = [
        `Connection check (${dayjs().format('YYYY-MM-DD HH:mm:ss')})`,
        `Verdict: ${verdict?.key ?? 'incomplete'}`,
      ]
      if (local) {
        lines.push(
          `Core: ${local.core ? 'running' : 'down'}`,
          `Local port: ${local.port} (${local.portOpen ? 'listening' : 'busy'})`,
          `System proxy: ${local.systemProxy ? 'on' : 'off'}`,
          `Enhanced: ${local.tun ? 'on' : 'off'}`,
          `Mode: ${local.clashMode}`,
          `Other proxy apps: ${local.otherApps === null ? 'unknown' : local.otherApps.join(', ') || 'none'}`,
        )
      }
      if (run.network) {
        const ms = (value: number | null) =>
          value === null
            ? 'n/a'
            : isUsableDelay(value)
              ? `${value} ms`
              : 'failed'
        lines.push(
          `Route: ${run.route.name ?? 'none'} (${ms(run.route.ms)})`,
          `Domestic site: ${ms(run.domestic.ms)}`,
          `Foreign site: ${ms(run.foreign.ms)}`,
          `Exit: ${run.exit.info ? [run.exit.info.code, run.exit.info.org].filter(Boolean).join(', ') : 'unknown'}`,
        )
      }
      await copyToClipboard(
        [base, lines.join('\n')].filter(Boolean).join('\n\n'),
      )
      showNotice.success(t('home.pewpew.diagnostics.copySuccess'))
    } catch {
      showNotice.error(t('home.pewpew.diagnostics.copyFailed'))
    }
  }

  const statusIcon = (status: CheckStatus | 'running') => {
    const sx = { fontSize: 18, flexShrink: 0 }
    switch (status) {
      case 'running':
        return <CircularProgress size={15} thickness={5} sx={{ m: '1.5px' }} />
      case 'ok':
        return <CheckCircleRounded sx={{ ...sx, color: 'success.main' }} />
      case 'warn':
        return <WarningAmberRounded sx={{ ...sx, color: 'warning.main' }} />
      case 'fail':
        return <ErrorRounded sx={{ ...sx, color: 'error.main' }} />
      case 'unknown':
        return <HelpOutlineRounded sx={{ ...sx, color: 'text.disabled' }} />
      default:
        return (
          <RemoveCircleOutlineRounded sx={{ ...sx, color: 'text.disabled' }} />
        )
    }
  }

  let rowIndex = 0
  const row = (
    key: string,
    label: string,
    value: string,
    status: CheckStatus | 'running',
  ) => {
    const index = rowIndex++
    return (
      <Stack
        key={key}
        direction="row"
        spacing={2}
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          py: 0.85,
          borderBottom: `1px solid ${hairlineColor(theme)}`,
          '&:last-of-type': { borderBottom: 0 },
          animation: `${rowIn} 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both`,
          animationDelay: `${index * 35}ms`,
          [reducedMotion]: { animation: 'none' },
        }}
      >
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}
        >
          {label}
        </Typography>
        <Stack
          direction="row"
          spacing={0.75}
          sx={{ alignItems: 'center', minWidth: 0, maxWidth: '62%' }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ minWidth: 0, textAlign: 'right', overflowWrap: 'anywhere' }}
          >
            {value}
          </Typography>
          {statusIcon(status)}
        </Stack>
      </Stack>
    )
  }

  const section = (title: string, rows: ReactNode) => (
    <Box>
      <Typography variant="body2" sx={{ ...sectionLabelSx, mb: 0.25 }}>
        {title}
      </Typography>
      <Box>{rows}</Box>
    </Box>
  )

  const msText = (ms: number) => `${ms} ${t('home.pewpew.delay.unit')}`
  const timedRow = (
    key: string,
    label: string,
    timed: Timed,
    slowMs: number,
  ) => {
    if (timed.running)
      return row(key, label, t('home.pewpew.check.testing'), 'running')
    const status = timedStatus(timed.ms, slowMs)
    const value =
      status === 'fail'
        ? t('home.pewpew.check.unreachable')
        : status === 'warn'
          ? t('home.pewpew.check.slow', { delay: msText(timed.ms!) })
          : timed.ms === null
            ? t('home.pewpew.compatibility.unknown')
            : msText(timed.ms)
    return row(key, label, value, status)
  }

  const takeoverOk = mode === 'enhanced' ? local?.tun : local?.systemProxy
  const verdictIcon = (tone: CheckVerdict['tone']) =>
    tone === 'success' ? (
      <CheckCircleRounded />
    ) : tone === 'error' ? (
      <ErrorRounded />
    ) : tone === 'warning' ? (
      <WarningAmberRounded />
    ) : (
      <InfoRounded />
    )

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      className="pewpew-dialog"
      slotProps={{
        paper: { sx: dialogPaperSx },
        backdrop: { sx: dialogBackdropSx },
      }}
    >
      <DialogTitle sx={{ fontWeight: 800, pb: 0.5 }}>
        {t('home.pewpew.compatibility.check')}
      </DialogTitle>
      <DialogContent>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mb: 1.75, lineHeight: 1.5 }}
        >
          {t('home.pewpew.check.subtitle')}
        </Typography>

        <Box aria-live="polite" sx={{ mb: 2 }}>
          {run.localFailed ? (
            <Alert severity="error" sx={{ borderRadius: '12px' }}>
              {t('home.pewpew.compatibility.checkFailed')}
            </Alert>
          ) : verdict ? (
            <Alert
              severity={verdict.tone}
              icon={verdictIcon(verdict.tone)}
              sx={{
                borderRadius: '12px',
                alignItems: 'center',
                '& .MuiAlert-action': { pt: 0, alignItems: 'center' },
              }}
              action={
                verdict.action ? (
                  <Button
                    size="small"
                    variant="contained"
                    color={verdict.tone === 'error' ? 'error' : 'primary'}
                    disabled={busy || acting}
                    onClick={() => void act(verdict.action)}
                    sx={{ ...pillButtonSx, whiteSpace: 'nowrap', minWidth: 0 }}
                  >
                    {acting ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      t(`home.pewpew.check.action.${verdict.action}`)
                    )}
                  </Button>
                ) : undefined
              }
            >
              {t(`home.pewpew.check.verdict.${verdict.key}`, verdict.params)}
            </Alert>
          ) : (
            <Stack
              direction="row"
              spacing={1.25}
              sx={{
                alignItems: 'center',
                px: 2,
                py: 1.5,
                borderRadius: '12px',
                border: `1px solid ${hairlineColor(theme)}`,
              }}
            >
              <CircularProgress size={18} thickness={5} />
              <Typography variant="body2" color="text.secondary">
                {t('home.pewpew.compatibility.checking')}
              </Typography>
            </Stack>
          )}
        </Box>

        {local && (
          <Stack spacing={1.75}>
            {section(
              t('home.pewpew.check.section.local'),
              <>
                {row(
                  'core',
                  t('home.pewpew.compatibility.core'),
                  t(
                    local.core
                      ? 'home.pewpew.check.running'
                      : 'home.pewpew.check.notRunning',
                  ),
                  local.core ? 'ok' : 'fail',
                )}
                {local.core &&
                  row(
                    'port',
                    t('home.pewpew.compatibility.port'),
                    t(
                      local.portOpen
                        ? 'home.pewpew.compatibility.portListening'
                        : 'home.pewpew.compatibility.portBusy',
                      { port: local.port },
                    ),
                    local.portOpen ? 'ok' : 'fail',
                  )}
                {row(
                  'takeover',
                  t(
                    mode === 'enhanced'
                      ? 'home.pewpew.compatibility.enhanced'
                      : 'home.pewpew.compatibility.systemProxy',
                  ),
                  !connected
                    ? t('home.pewpew.check.notConnected')
                    : t(
                        takeoverOk
                          ? 'home.pewpew.compatibility.active'
                          : 'home.pewpew.check.notActive',
                      ),
                  !connected ? 'off' : takeoverOk ? 'ok' : 'warn',
                )}
                {mode === 'enhanced' &&
                  row(
                    'service',
                    t('home.pewpew.compatibility.service'),
                    t(
                      local.service
                        ? 'home.pewpew.compatibility.active'
                        : 'home.pewpew.compatibility.inactive',
                    ),
                    local.service ? 'ok' : 'off',
                  )}
                {row(
                  'apps',
                  t('home.pewpew.compatibility.otherApps'),
                  local.otherApps === null
                    ? t('home.pewpew.compatibility.unknown')
                    : local.otherApps.length
                      ? local.otherApps.join(', ')
                      : t('home.pewpew.compatibility.noOtherApps'),
                  local.otherApps === null
                    ? 'unknown'
                    : local.otherApps.length
                      ? 'warn'
                      : 'ok',
                )}
              </>,
            )}

            {run.network ? (
              <>
                {section(
                  t('home.pewpew.check.section.route'),
                  <>
                    {run.route.running
                      ? row(
                          'route',
                          run.route.name ?? t('home.pewpew.connection.route'),
                          t('home.pewpew.check.testing'),
                          'running',
                        )
                      : row(
                          'route',
                          run.route.name ?? t('home.pewpew.connection.route'),
                          run.route.ms === null
                            ? t('home.pewpew.connection.selectRoute')
                            : isUsableDelay(run.route.ms)
                              ? msText(run.route.ms)
                              : t('home.pewpew.check.unreachable'),
                          timedStatus(run.route.ms, ROUTE_SLOW_MS),
                        )}
                    {row(
                      'udp',
                      t('home.pewpew.compatibility.udp'),
                      t(
                        `home.pewpew.compatibility.${udp === true ? 'supported' : udp === false ? 'unsupported' : 'unknown'}`,
                      ),
                      udp === true ? 'ok' : udp === false ? 'warn' : 'unknown',
                    )}
                    {local.tun &&
                      row(
                        'discord',
                        t('home.pewpew.discord.label'),
                        t(
                          `home.pewpew.discord.${local.discord?.state ?? 'following'}`,
                          { route: local.discord?.route ?? '' },
                        ),
                        local.discord?.state === 'selected' ? 'ok' : 'unknown',
                      )}
                  </>,
                )}
                {section(
                  t('home.pewpew.check.section.sites'),
                  <>
                    {timedRow(
                      'domestic',
                      t('home.pewpew.check.domestic'),
                      run.domestic,
                      DOMESTIC_SLOW_MS,
                    )}
                    {timedRow(
                      'foreign',
                      t('home.pewpew.check.foreign'),
                      run.foreign,
                      FOREIGN_SLOW_MS,
                    )}
                    {run.exit.running
                      ? row(
                          'exit',
                          t('home.pewpew.check.exit'),
                          t('home.pewpew.check.testing'),
                          'running',
                        )
                      : row(
                          'exit',
                          t('home.pewpew.check.exit'),
                          run.exit.info
                            ? [
                                `${regionFlag(run.exit.info.code)} ${
                                  run.exit.info.code
                                    ? regionName(
                                        run.exit.info.code,
                                        i18n.language,
                                      )
                                    : run.exit.info.country
                                }`.trim(),
                                run.exit.info.org,
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            : t('home.pewpew.check.exitUnknown'),
                          run.exit.info ? 'ok' : 'unknown',
                        )}
                  </>,
                )}
              </>
            ) : (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ lineHeight: 1.5 }}
              >
                {t('home.pewpew.check.networkSkipped')}
              </Typography>
            )}

            {run.done &&
              connected &&
              mode === 'standard' &&
              onSwitchEnhanced && (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    color: 'text.secondary',
                  }}
                >
                  <Typography variant="caption" sx={{ lineHeight: 1.45 }}>
                    {t('home.pewpew.check.enhancedTip')}
                  </Typography>
                  <Button
                    size="small"
                    disabled={busy || acting}
                    onClick={onSwitchEnhanced}
                    sx={{ ...pillButtonSx, flexShrink: 0 }}
                  >
                    {t('home.pewpew.compatibility.switchToEnhanced')}
                  </Button>
                </Stack>
              )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexWrap: 'wrap' }}>
        {buildDiagnostics && (
          <Button
            startIcon={<ContentCopyRounded />}
            disabled={!run.done}
            onClick={() => void copyReport()}
            sx={pillButtonSx}
          >
            {t('home.pewpew.check.copyReport')}
          </Button>
        )}
        <Button
          startIcon={<RefreshRounded />}
          disabled={!run.done || acting}
          onClick={() => void start()}
          sx={{ ...pillButtonSx, mr: 'auto', ml: '0 !important' }}
        >
          {t('home.pewpew.check.again')}
        </Button>
        <Button
          variant="contained"
          onClick={onClose}
          sx={{ ...pillButtonSx, ml: '0 !important' }}
        >
          {t('shared.actions.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
