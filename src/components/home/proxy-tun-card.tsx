import {
  BuildRounded,
  CheckCircleRounded,
  ContentCopyRounded,
  HelpOutlineRounded,
  RemoveCircleOutlineRounded,
  ShieldOutlined,
  TroubleshootRounded,
  WarningAmberRounded,
} from '@mui/icons-material'
import {
  Box,
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
  keyframes,
  useTheme,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { type FC, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  dialogBackdropSx,
  dialogPaperSx,
  pillButtonSx,
  reducedMotion,
  sectionLabelSx,
  segmentedControlSx,
  strongMutedColor,
  toneTextColor,
} from '@/components/home/pewpew-ui'
import {
  PowerButton,
  type PowerButtonTone,
} from '@/components/home/power-button'
import { useConnectionState } from '@/hooks/use-connection-state'
import {
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import { isServiceAvailable } from '@/services/cmds'
import { readConnectionState } from '@/services/connection'
import { showNotice } from '@/services/notice-service'
import type { ConnectionMode } from '@/utils/connection-state'
import { resolvePewPewProxyGroup } from '@/utils/pewpew-client'

interface ProxyTunCardProps {
  disabled?: boolean
  hasRoute?: boolean
  connectionBlocked?: boolean
  connectionBlockedText?: string
  repairing?: boolean
  onRepairNetwork?: () => Promise<void>
  onCopyDiagnostics?: () => Promise<void>
  onConnectionError?: (message: string) => void
  // Last error owned by the page; an empty string clears a stale failure.
  connectionError?: string
  // Secondary status line, e.g. "Smart Mode · Hong Kong 01 · 86 ms".
  statusDetail?: string
  statusTone?: 'default' | 'warning' | 'error'
  // Shown on the main button while it is disabled for loading or updating.
  pendingLabel?: string
  // Runs before connecting; return false to cancel (it reports its own notice).
  beforeConnect?: () => Promise<boolean>
  footer?: ReactNode
}

type ConnectionAction = 'connect' | 'disconnect' | 'switch' | 'repair'

type ConnectionPhase = 'idle' | 'connecting' | 'disconnecting' | 'switching'

type ConnectionFailure = {
  action: ConnectionAction
  // Connection state once the failed attempt settled; a later change (for
  // example connecting from the tray) means the failure no longer applies.
  enabledAfter: boolean | null
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

const getErrorNoticeKey = (
  message: string,
  action: ConnectionAction,
  mode: ConnectionMode,
) => {
  if (message.includes('pewpew-service-conflict'))
    return 'home.pewpew.compatibility.serviceConflict'
  if (message.includes('rollback-failed'))
    return 'home.pewpew.compatibility.rollbackFailed'
  if (message.includes('pewpew-core-unavailable'))
    return 'home.pewpew.connectionStatus.coreUnavailable'
  if (message.includes('pewpew-service-unavailable'))
    return 'home.pewpew.compatibility.serviceUnavailable'
  if (message.includes('verification-failed'))
    return 'home.pewpew.connectionStatus.verificationFailed'
  if (action === 'disconnect')
    return 'home.pewpew.connectionStatus.disconnectFailed'
  if (action === 'connect' && mode === 'standard')
    return 'home.pewpew.connectionStatus.connectFailed'
  return 'home.pewpew.compatibility.changeFailed'
}

const statusPulse = keyframes`
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.6); opacity: 0.35; }
  100% { transform: scale(1); opacity: 1; }
`

export const ProxyTunCard: FC<ProxyTunCardProps> = ({
  disabled = false,
  hasRoute = true,
  connectionBlocked = false,
  connectionBlockedText,
  repairing = false,
  onRepairNetwork,
  onCopyDiagnostics,
  onConnectionError,
  connectionError,
  statusDetail,
  statusTone = 'default',
  pendingLabel,
  beforeConnect,
  footer,
}) => {
  const theme = useTheme()
  const { t } = useTranslation()
  const {
    enabled,
    tun,
    mode,
    accepted,
    busy: changing,
    change,
  } = useConnectionState()
  const { proxies } = useProxiesData()
  const { clashConfig } = useClashConfigData()
  const selected = resolvePewPewProxyGroup(proxies, clashConfig?.mode)
  const udp = proxies?.records?.[selected.currentName]?.udp as
    | boolean
    | undefined
  const [phase, setPhase] = useState<ConnectionPhase>('idle')
  const [failure, setFailure] = useState<ConnectionFailure | null>(null)
  const [consentAction, setConsentAction] = useState<'connect' | 'mode' | null>(
    null,
  )
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnostics, setDiagnostics] = useState<{
    systemProxy: boolean
    tun: boolean
    service: boolean
    core: boolean
  } | null>(null)
  const [diagnosticsFailed, setDiagnosticsFailed] = useState(false)

  const busy = changing || phase !== 'idle' || repairing

  // Record the settled connection state once the failed attempt finishes; a
  // later change (e.g. connecting from the tray) means the failure is over.
  if (failure && !busy) {
    if (failure.enabledAfter === null) {
      setFailure({ ...failure, enabledAfter: enabled })
    } else if (failure.enabledAfter !== enabled) {
      setFailure(null)
    }
  }

  const failureActive =
    !!failure &&
    connectionError !== '' &&
    (failure.enabledAfter === null || failure.enabledAfter === enabled)
  const incomplete = enabled && mode === 'enhanced' && !tun && !busy
  const failed = failureActive || incomplete
  const connectBlocked = connectionBlocked && !enabled && !failed
  const showPending = disabled && !!pendingLabel && !enabled

  const statusKey =
    phase === 'switching'
      ? 'home.pewpew.compatibility.switching'
      : phase === 'connecting'
        ? 'home.pewpew.connectionStatus.connecting'
        : phase === 'disconnecting'
          ? 'home.pewpew.connectionStatus.disconnecting'
          : incomplete
            ? 'home.pewpew.compatibility.incomplete'
            : failed
              ? 'home.pewpew.connectionStatus.failed'
              : enabled
                ? 'home.pewpew.connectionStatus.connected'
                : 'home.pewpew.connectionStatus.disconnected'
  const actionKey =
    phase === 'switching'
      ? 'home.pewpew.compatibility.switching'
      : phase === 'connecting'
        ? 'home.pewpew.connectionStatus.connecting'
        : phase === 'disconnecting'
          ? 'home.pewpew.connectionStatus.disconnecting'
          : enabled
            ? 'home.pewpew.connectionStatus.disconnect'
            : failed
              ? 'home.pewpew.connectionStatus.reconnect'
              : 'home.pewpew.connectionStatus.connect'

  const isConnectedLook = enabled && !failed && !busy
  // Connected but not through a route (e.g. direct mode): warn, don't celebrate.
  const connectedWarning = isConnectedLook && statusTone === 'warning'
  const statusColor = failed
    ? theme.palette.error.main
    : busy
      ? theme.palette.primary.main
      : connectedWarning
        ? toneTextColor(theme, 'warning')
        : enabled
          ? theme.palette.success.main
          : theme.palette.text.disabled
  const buttonDisabled = disabled || busy || connectBlocked
  const powerTone: PowerButtonTone =
    busy || showPending
      ? 'busy'
      : buttonDisabled
        ? 'unavailable'
        : failed
          ? 'failed'
          : connectedWarning
            ? 'warning'
            : isConnectedLook
              ? 'connected'
              : 'idle'

  const reportError = (
    err: unknown,
    action: ConnectionAction,
    notify = true,
  ) => {
    const message = getErrorMessage(err) || 'pewpew-connection-error'
    setFailure({ action, enabledAfter: null })
    setPhase('idle')
    onConnectionError?.(message)
    if (notify) showNotice.error(t(getErrorNoticeKey(message, action, mode)))
  }

  const clearFailure = () => {
    setFailure(null)
    onConnectionError?.('')
  }

  const runConnection = async (next: boolean, acceptEnhanced = false) => {
    if (disabled || busy) return
    if (next && (connectionBlocked || !hasRoute)) {
      showNotice.error(
        connectionBlockedText || t('home.pewpew.connection.importFirst'),
      )
      return
    }
    setFailure(null)
    setPhase(next ? 'connecting' : 'disconnecting')
    try {
      if (next && beforeConnect && !(await beforeConnect())) {
        reportError('pewpew-route-unavailable', 'connect', false)
        return
      }
      await change({ enabled: next, acceptEnhanced })
      setPhase('idle')
      clearFailure()
    } catch (err) {
      reportError(err, next ? 'connect' : 'disconnect')
    }
  }

  const handleConnectionAction = useLockFn(async () => {
    if (disabled || busy) return
    const next = !enabled
    if (next && connectionBlocked) {
      showNotice.error(
        connectionBlockedText || t('home.pewpew.connection.importFirst'),
      )
      return
    }
    if (next && !hasRoute) {
      showNotice.error(t('home.pewpew.connection.importFirst'))
      return
    }

    if (next && mode === 'enhanced' && !accepted) {
      setConsentAction('connect')
      return
    }
    await runConnection(next)
  })

  const selectMode = useLockFn(
    async (next: ConnectionMode, consent = false) => {
      if (disabled || busy) return
      if (next === 'enhanced' && !accepted && !consent) {
        setConsentAction('mode')
        return
      }
      setFailure(null)
      setPhase('switching')
      try {
        await change({ mode: next, acceptEnhanced: consent })
        setPhase('idle')
        clearFailure()
      } catch (err) {
        reportError(err, 'switch')
      }
    },
  )

  const inspectConnection = useLockFn(async () => {
    setDiagnosticsOpen(true)
    setDiagnosticsLoading(true)
    setDiagnosticsFailed(false)
    setDiagnostics(null)
    try {
      const [state, service] = await Promise.all([
        readConnectionState(),
        isServiceAvailable().catch(() => false),
      ])
      setDiagnostics({
        systemProxy: state.systemProxy,
        tun: state.tun,
        service,
        core: !!state.config,
      })
    } catch {
      setDiagnosticsFailed(true)
    } finally {
      setDiagnosticsLoading(false)
    }
  })

  const handleRepair = useLockFn(async () => {
    try {
      await onRepairNetwork?.()
      setPhase('idle')
      clearFailure()
    } catch (error) {
      // The page already reported the repair failure; only keep the state.
      reportError(error, 'repair', false)
    }
  })

  const diagnosticsSummary = (() => {
    if (!diagnostics) return null
    if (!diagnostics.core)
      return {
        severity: 'error' as const,
        key: 'home.pewpew.compatibility.summaryCoreDown',
      }
    if (diagnostics.systemProxy || diagnostics.tun) {
      if (mode === 'enhanced' && !diagnostics.tun)
        return {
          severity: 'warning' as const,
          key: 'home.pewpew.compatibility.summaryEnhancedMissing',
        }
      return {
        severity: 'success' as const,
        key:
          mode === 'enhanced'
            ? 'home.pewpew.compatibility.summaryEnhancedActive'
            : 'home.pewpew.compatibility.summaryStandardActive',
      }
    }
    return {
      severity: 'info' as const,
      key: 'home.pewpew.compatibility.summaryDisconnected',
    }
  })()

  const renderStateIcon = (state: 'ok' | 'off' | 'warn' | 'unknown') => {
    const sx = { fontSize: 18 }
    if (state === 'ok')
      return <CheckCircleRounded sx={{ ...sx, color: 'success.main' }} />
    if (state === 'warn')
      return <WarningAmberRounded sx={{ ...sx, color: 'warning.main' }} />
    if (state === 'unknown')
      return <HelpOutlineRounded sx={{ ...sx, color: 'text.disabled' }} />
    return <RemoveCircleOutlineRounded sx={{ ...sx, color: 'text.disabled' }} />
  }

  const renderDiagnosticRow = (
    label: string,
    value: string,
    state: 'ok' | 'off' | 'warn' | 'unknown',
  ) => (
    <Stack
      key={label}
      direction="row"
      spacing={2}
      sx={{
        alignItems: 'center',
        justifyContent: 'space-between',
        py: 0.9,
        borderBottom: `1px solid ${theme.palette.divider}`,
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        {renderStateIcon(state)}
        <Typography variant="body2" color="text.secondary">
          {value}
        </Typography>
      </Stack>
    </Stack>
  )

  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
      <Stack spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
        <Typography variant="body2" sx={sectionLabelSx}>
          {t('home.pewpew.connectionStatus.title')}
        </Typography>
        <Stack
          direction="row"
          spacing={1.25}
          sx={{ alignItems: 'center', justifyContent: 'center' }}
        >
          <Box
            aria-hidden
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              flexShrink: 0,
              bgcolor: statusColor,
              boxShadow:
                isConnectedLook && !connectedWarning
                  ? `0 0 0 4px ${alpha(statusColor, 0.18)} !important`
                  : 'none',
              transition: 'background-color 320ms ease',
              animation: busy ? `${statusPulse} 1.2s ease-in-out infinite` : '',
              [reducedMotion]: { animation: 'none', transition: 'none' },
            }}
          />
          <Typography
            variant="h5"
            component="p"
            role="status"
            sx={{
              fontWeight: 700,
              fontSize: { xs: 26, sm: 30 },
              lineHeight: 1.2,
              overflowWrap: 'anywhere',
              transition: 'color 320ms ease',
              color: failed
                ? toneTextColor(theme, 'error')
                : connectedWarning
                  ? toneTextColor(theme, 'warning')
                  : enabled && !busy
                    ? 'success.main'
                    : 'text.primary',
              [reducedMotion]: { transition: 'none' },
            }}
          >
            {t(statusKey)}
          </Typography>
        </Stack>
        {statusDetail && (
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              maxWidth: { xs: 'none', md: 380 },
              overflowWrap: 'anywhere',
              color:
                statusTone === 'default'
                  ? strongMutedColor(theme)
                  : toneTextColor(theme, statusTone),
            }}
          >
            {statusDetail}
          </Typography>
        )}
      </Stack>

      <PowerButton
        tone={powerTone}
        disabled={buttonDisabled}
        spinning={busy || showPending}
        compact={connectBlocked}
        onClick={handleConnectionAction}
        label={showPending ? pendingLabel : t(actionKey)}
      />

      {footer}

      {failed && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{
            width: '100%',
            maxWidth: { xs: 'none', md: 380 },
            justifyContent: 'center',
          }}
        >
          <Button
            size="small"
            variant="outlined"
            onClick={handleRepair}
            disabled={disabled || busy}
            startIcon={<BuildRounded />}
            sx={pillButtonSx}
          >
            {t('home.pewpew.connectionStatus.repairNetwork')}
          </Button>
          {onCopyDiagnostics && (
            <Button
              size="small"
              variant="text"
              onClick={() => void onCopyDiagnostics()}
              startIcon={<ContentCopyRounded />}
              sx={pillButtonSx}
            >
              {t('home.pewpew.diagnostics.copy')}
            </Button>
          )}
        </Stack>
      )}

      <Box
        sx={{
          width: '100%',
          maxWidth: { xs: 'none', md: 380 },
          textAlign: 'left',
        }}
      >
        <Typography variant="body2" sx={{ ...sectionLabelSx, mb: 0.75 }}>
          {t('home.pewpew.compatibility.mode')}
        </Typography>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={mode}
          disabled={disabled || busy}
          aria-label={t('home.pewpew.compatibility.mode')}
          onChange={(_, value: ConnectionMode | null) => {
            if (value) void selectMode(value)
          }}
          sx={segmentedControlSx}
        >
          <ToggleButton value="standard">
            {t('home.pewpew.compatibility.standard')}
          </ToggleButton>
          <ToggleButton value="enhanced">
            {t('home.pewpew.compatibility.enhanced')}
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ mt: 0.75, lineHeight: 1.45 }}
        >
          {t(
            mode === 'enhanced'
              ? 'home.pewpew.compatibility.enhancedHint'
              : 'home.pewpew.compatibility.standardHint',
          )}
        </Typography>
      </Box>

      {mode === 'enhanced' && udp === false && (
        <Alert
          severity="warning"
          sx={{
            textAlign: 'left',
            width: '100%',
            maxWidth: { xs: 'none', md: 380 },
            boxSizing: 'border-box',
            borderRadius: '12px',
          }}
        >
          {t('home.pewpew.compatibility.udpUnsupported')}
        </Alert>
      )}

      <Button
        size="small"
        startIcon={<TroubleshootRounded />}
        disabled={busy || diagnosticsLoading}
        onClick={() => void inspectConnection()}
        sx={pillButtonSx}
      >
        {t('home.pewpew.compatibility.check')}
      </Button>

      <Dialog
        open={consentAction !== null}
        onClose={() => setConsentAction(null)}
        fullWidth
        maxWidth="xs"
        className="pewpew-dialog"
        slotProps={{
          paper: { sx: dialogPaperSx },
          backdrop: { sx: dialogBackdropSx },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>
          {t('home.pewpew.compatibility.permissionTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ lineHeight: 1.7 }}>
            {t('home.pewpew.compatibility.permissionBody')}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConsentAction(null)} sx={pillButtonSx}>
            {t('shared.actions.cancel')}
          </Button>
          <Button
            variant="contained"
            startIcon={<ShieldOutlined />}
            sx={pillButtonSx}
            onClick={() => {
              const action = consentAction
              setConsentAction(null)
              if (action === 'connect') void runConnection(true, true)
              else void selectMode('enhanced', true)
            }}
          >
            {t('home.pewpew.compatibility.allow')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        fullWidth
        maxWidth="xs"
        className="pewpew-dialog"
        slotProps={{
          paper: { sx: dialogPaperSx },
          backdrop: { sx: dialogBackdropSx },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>
          {t('home.pewpew.compatibility.check')}
        </DialogTitle>
        <DialogContent>
          {diagnosticsLoading && (
            <Stack
              direction="row"
              spacing={1.25}
              sx={{ alignItems: 'center', py: 1 }}
            >
              <CircularProgress
                size={20}
                aria-label={t('home.pewpew.compatibility.checking')}
              />
              <Typography variant="body2" color="text.secondary">
                {t('home.pewpew.compatibility.checking')}
              </Typography>
            </Stack>
          )}
          {diagnosticsFailed && (
            <Alert severity="error" sx={{ borderRadius: '12px' }}>
              {t('home.pewpew.compatibility.checkFailed')}
            </Alert>
          )}
          {diagnostics && (
            <Stack spacing={1.5}>
              {diagnosticsSummary && (
                <Alert
                  severity={diagnosticsSummary.severity}
                  sx={{ borderRadius: '12px' }}
                >
                  {t(diagnosticsSummary.key)}
                </Alert>
              )}
              <Box>
                {(
                  [
                    ['core', diagnostics.core],
                    ['systemProxy', diagnostics.systemProxy],
                    ['enhanced', diagnostics.tun],
                    ['service', diagnostics.service],
                  ] as const
                ).map(([label, active]) =>
                  renderDiagnosticRow(
                    t(`home.pewpew.compatibility.${label}`),
                    t(
                      `home.pewpew.compatibility.${active ? 'active' : 'inactive'}`,
                    ),
                    active ? 'ok' : 'off',
                  ),
                )}
                {renderDiagnosticRow(
                  t('home.pewpew.compatibility.udp'),
                  t(
                    `home.pewpew.compatibility.${udp === true ? 'supported' : udp === false ? 'unsupported' : 'unknown'}`,
                  ),
                  udp === true ? 'ok' : udp === false ? 'warn' : 'unknown',
                )}
                {renderDiagnosticRow(
                  t('home.pewpew.compatibility.voice'),
                  t('home.pewpew.compatibility.notTested'),
                  'unknown',
                )}
              </Box>
              {udp === false && (
                <Alert severity="warning" sx={{ borderRadius: '12px' }}>
                  {t('home.pewpew.compatibility.udpUnsupported')}
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          {mode === 'standard' && (
            <Button
              disabled={busy || disabled || diagnosticsLoading}
              sx={{ ...pillButtonSx, mr: 'auto' }}
              onClick={() => {
                setDiagnosticsOpen(false)
                void selectMode('enhanced')
              }}
            >
              {t('home.pewpew.compatibility.switchToEnhanced')}
            </Button>
          )}
          <Button
            variant="contained"
            onClick={() => setDiagnosticsOpen(false)}
            sx={pillButtonSx}
          >
            {t('shared.actions.close')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
