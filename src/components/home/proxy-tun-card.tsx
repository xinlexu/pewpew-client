import {
  BuildRounded,
  ContentCopyRounded,
  ShieldOutlined,
  SpeedRounded,
  TroubleshootRounded,
} from '@mui/icons-material'
import {
  Box,
  Alert,
  Button,
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
import { showNotice } from '@/services/notice-service'
import type { ConnectionMode } from '@/utils/connection-state'
import { resolvePewPewProxyGroup } from '@/utils/pewpew-client'

import { ConnectionCheckDialog } from './connection-check-dialog'

interface ProxyTunCardProps {
  disabled?: boolean
  hasRoute?: boolean
  connectionBlocked?: boolean
  connectionBlockedText?: string
  repairing?: boolean
  onRepairNetwork?: () => Promise<void>
  onCopyDiagnostics?: () => Promise<void>
  // Full diagnostics text; the connection check appends its results.
  buildDiagnostics?: () => Promise<string>
  onConnectionError?: (message: string) => void
  // Last error owned by the page; an empty string clears a stale failure.
  connectionError?: string
  // Secondary status line, e.g. "Smart Mode · Hong Kong 01 · 86 ms".
  statusDetail?: string
  statusTone?: 'default' | 'warning' | 'error'
  // Shown on the main button while it is disabled for loading or updating.
  pendingLabel?: string
  // Runs before connecting; false stops with a failure (it reports its own
  // notice), 'cancelled' stops quietly because the user chose to.
  beforeConnect?: () => Promise<boolean | 'cancelled'>
  // Opens the speed test; the button shows only while connected.
  onSpeedTest?: () => void
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
  if (message.includes('pewpew-service-install-cancelled'))
    return 'home.pewpew.compatibility.permissionDenied'
  if (
    message.includes('pewpew-service-install-failed') ||
    message.includes('failed to install service')
  )
    return 'home.pewpew.compatibility.serviceInstallFailed'
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

// The status line fades in whenever its text changes. Opacity only, so the
// line never moves or overflows while it animates.
const statusSwap = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

// Diagnostic rows appear one after another.
export const ProxyTunCard: FC<ProxyTunCardProps> = ({
  disabled = false,
  hasRoute = true,
  connectionBlocked = false,
  connectionBlockedText,
  repairing = false,
  onRepairNetwork,
  onCopyDiagnostics,
  buildDiagnostics,
  onConnectionError,
  connectionError,
  statusDetail,
  statusTone = 'default',
  pendingLabel,
  beforeConnect,
  onSpeedTest,
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
  // Mounted on first use, then kept so closing can animate.
  const [checkMounted, setCheckMounted] = useState(false)

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
      const ready = next && beforeConnect ? await beforeConnect() : true
      if (ready === 'cancelled') {
        setPhase('idle')
        return
      }
      if (!ready) {
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

  const inspectConnection = () => {
    setCheckMounted(true)
    setDiagnosticsOpen(true)
  }

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
            {/* Keyed so the new text eases in; the live region stays put. */}
            <Box
              component="span"
              key={statusKey}
              sx={{
                animation: `${statusSwap} 260ms ease both`,
                [reducedMotion]: { animation: 'none' },
              }}
            >
              {t(statusKey)}
            </Box>
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

      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
      >
        <Button
          size="small"
          startIcon={<TroubleshootRounded />}
          disabled={busy}
          onClick={inspectConnection}
          sx={pillButtonSx}
        >
          {t('home.pewpew.compatibility.check')}
        </Button>
        {onSpeedTest && isConnectedLook && (
          <Button
            size="small"
            startIcon={<SpeedRounded />}
            onClick={onSpeedTest}
            sx={pillButtonSx}
          >
            {t('home.pewpew.speedTest.button')}
          </Button>
        )}
      </Stack>

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

      {checkMounted && (
        <ConnectionCheckDialog
          open={diagnosticsOpen}
          onClose={() => setDiagnosticsOpen(false)}
          connected={enabled}
          mode={mode}
          busy={busy || disabled}
          udp={udp}
          onRepair={onRepairNetwork ? handleRepair : undefined}
          onSwitchEnhanced={() => {
            setDiagnosticsOpen(false)
            void selectMode('enhanced')
          }}
          buildDiagnostics={buildDiagnostics}
        />
      )}
    </Stack>
  )
}
