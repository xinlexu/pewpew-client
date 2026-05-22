import {
  BuildRounded,
  ContentCopyRounded,
  PowerSettingsNewRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { showNotice } from '@/services/notice-service'

interface ProxyTunCardProps {
  disabled?: boolean
  hasRoute?: boolean
  repairing?: boolean
  onRepairNetwork?: () => Promise<void>
  onCopyDiagnostics?: () => Promise<void>
  onConnectionError?: (message: string) => void
}

type ConnectionPhase = 'idle' | 'connecting' | 'disconnecting' | 'failed'

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

export const ProxyTunCard: FC<ProxyTunCardProps> = ({
  disabled = false,
  hasRoute = true,
  repairing = false,
  onRepairNetwork,
  onCopyDiagnostics,
  onConnectionError,
}) => {
  const theme = useTheme()
  const { t } = useTranslation()
  const {
    indicator: systemProxyEnabled,
    setSystemProxyEnabled,
    invalidateProxyState,
  } = useSystemProxyState()
  const [phase, setPhase] = useState<ConnectionPhase>('idle')
  const [confirmedState, setConfirmedState] = useState<boolean | null>(null)

  useEffect(() => {
    if (confirmedState !== null && systemProxyEnabled === confirmedState) {
      queueMicrotask(() => setConfirmedState(null))
    }
  }, [confirmedState, systemProxyEnabled])

  const enabled = confirmedState ?? systemProxyEnabled
  const busy = phase === 'connecting' || phase === 'disconnecting' || repairing
  const failed = phase === 'failed'
  const statusKey =
    phase === 'connecting'
      ? 'home.pewpew.connectionStatus.connecting'
      : phase === 'disconnecting'
        ? 'home.pewpew.connectionStatus.disconnecting'
        : failed
          ? 'home.pewpew.connectionStatus.failed'
          : enabled
            ? 'home.pewpew.connectionStatus.connected'
            : 'home.pewpew.connectionStatus.disconnected'
  const actionKey =
    phase === 'connecting'
      ? 'home.pewpew.connectionStatus.connecting'
      : phase === 'disconnecting'
        ? 'home.pewpew.connectionStatus.disconnecting'
        : failed
          ? 'home.pewpew.connectionStatus.reconnect'
          : enabled
            ? 'home.pewpew.connectionStatus.disconnect'
            : 'home.pewpew.connectionStatus.connect'

  const handleConnectionAction = useLockFn(async () => {
    const next = failed ? true : !enabled
    if (next && !hasRoute) {
      showNotice.error(t('home.pewpew.connection.importFirst'))
      return
    }

    setPhase(next ? 'connecting' : 'disconnecting')
    setConfirmedState(null)

    try {
      await setSystemProxyEnabled(next)
      await invalidateProxyState()
      setConfirmedState(next)
      setPhase('idle')
      onConnectionError?.('')
    } catch (err) {
      const message = getErrorMessage(err)
      setPhase('failed')
      setConfirmedState(null)
      onConnectionError?.(message)
      showNotice.error(
        next
          ? t('home.pewpew.connectionStatus.connectFailed')
          : t('home.pewpew.connectionStatus.disconnectFailed'),
      )
    }
  })

  const handleRepair = useLockFn(async () => {
    await onRepairNetwork?.()
    setPhase('idle')
    setConfirmedState(false)
    onConnectionError?.('')
  })

  return (
    <Stack spacing={1.35} sx={{ alignItems: 'center', textAlign: 'center' }}>
      <Typography
        variant="body2"
        sx={{
          fontWeight: 850,
          letterSpacing: 0,
          color: 'text.secondary',
        }}
      >
        {t('home.pewpew.connectionStatus.title')}
      </Typography>

      <Typography
        variant="h4"
        sx={{
          fontWeight: 950,
          lineHeight: 1.05,
          color: failed
            ? 'error.main'
            : enabled
              ? 'success.main'
              : 'text.primary',
        }}
      >
        {t(statusKey)}
      </Typography>

      <Button
        fullWidth
        variant="contained"
        color={enabled && !failed ? 'success' : 'primary'}
        onClick={handleConnectionAction}
        disabled={disabled || busy}
        sx={{
          minHeight: { xs: 112, sm: 126 },
          borderRadius: 999,
          boxShadow:
            enabled && !failed
              ? '0 18px 40px rgba(30, 150, 95, 0.28)'
              : '0 18px 40px rgba(44, 103, 220, 0.28)',
          textTransform: 'none',
          justifyContent: 'center',
          px: { xs: 2, sm: 3 },
          py: 2,
          bgcolor: enabled && !failed ? '#16a36f' : '#2869df',
          background:
            enabled && !failed
              ? 'linear-gradient(135deg, #16a36f 0%, #39bd86 100%)'
              : 'linear-gradient(135deg, #2869df 0%, #5b8cf0 100%)',
          '&:hover': {
            boxShadow:
              enabled && !failed
                ? '0 20px 44px rgba(30, 150, 95, 0.34)'
                : '0 20px 44px rgba(44, 103, 220, 0.34)',
            bgcolor: enabled && !failed ? '#11875c' : '#205ac2',
          },
          '&.Mui-disabled': {
            color: alpha(theme.palette.common.white, 0.72),
            background: theme.palette.mode === 'light' ? '#9ca3af' : '#374151',
            boxShadow: 'none',
          },
        }}
      >
        <Stack
          direction="row"
          spacing={1.4}
          sx={{
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 0,
          }}
        >
          <Box
            sx={{
              width: 54,
              height: 54,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(theme.palette.common.white, 0.18),
              border: `1px solid ${alpha(theme.palette.common.white, 0.45)}`,
              boxShadow: `inset 0 0 0 1px ${alpha(
                theme.palette.common.white,
                0.15,
              )}, 0 10px 24px ${alpha(theme.palette.common.black, 0.14)}`,
              flexShrink: 0,
            }}
          >
            {busy ? (
              <CircularProgress size={28} color="inherit" thickness={4} />
            ) : (
              <PowerSettingsNewRounded sx={{ fontSize: 31 }} />
            )}
          </Box>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 950,
              lineHeight: 1.15,
              overflowWrap: 'anywhere',
            }}
          >
            {t(actionKey)}
          </Typography>
        </Stack>
      </Button>

      {failed && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ width: '100%', justifyContent: 'center' }}
        >
          <Button
            size="small"
            variant="outlined"
            onClick={handleRepair}
            disabled={disabled || repairing}
            startIcon={<BuildRounded />}
            sx={{ borderRadius: 999, fontWeight: 800 }}
          >
            {t('home.pewpew.connectionStatus.repairNetwork')}
          </Button>
          {onCopyDiagnostics && (
            <Button
              size="small"
              variant="text"
              onClick={() => void onCopyDiagnostics()}
              startIcon={<ContentCopyRounded />}
              sx={{ borderRadius: 999, fontWeight: 800 }}
            >
              {t('home.pewpew.diagnostics.copy')}
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  )
}
