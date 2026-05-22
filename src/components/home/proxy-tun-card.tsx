import { PowerSettingsNewRounded } from '@mui/icons-material'
import { Box, Button, Stack, Typography, alpha, useTheme } from '@mui/material'
import { useLockFn } from 'ahooks'
import { FC, useState } from 'react'

import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { showNotice } from '@/services/notice-service'

interface ProxyTunCardProps {
  disabled?: boolean
}

export const ProxyTunCard: FC<ProxyTunCardProps> = ({ disabled = false }) => {
  const theme = useTheme()
  const { indicator: systemProxyEnabled, setSystemProxyEnabled } =
    useSystemProxyState()
  const [pendingState, setPendingState] = useState<boolean | null>(null)

  const enabled = pendingState ?? systemProxyEnabled

  const handleToggle = useLockFn(async () => {
    const next = !enabled
    setPendingState(next)

    try {
      await setSystemProxyEnabled(next)
    } catch (err) {
      showNotice.error(err)
      setPendingState(systemProxyEnabled)
    } finally {
      setPendingState(null)
    }
  })

  return (
    <Button
      fullWidth
      variant="contained"
      color={enabled ? 'success' : 'primary'}
      onClick={handleToggle}
      disabled={disabled}
      sx={{
        minHeight: { xs: 150, sm: 168 },
        borderRadius: 999,
        boxShadow: enabled
          ? '0 18px 40px rgba(30, 150, 95, 0.28)'
          : '0 18px 40px rgba(44, 103, 220, 0.28)',
        textTransform: 'none',
        justifyContent: 'center',
        px: { xs: 2, sm: 3 },
        py: 2,
        bgcolor: enabled ? '#16a36f' : '#2869df',
        background: enabled
          ? 'linear-gradient(135deg, #16a36f 0%, #39bd86 100%)'
          : 'linear-gradient(135deg, #2869df 0%, #5b8cf0 100%)',
        '&:hover': {
          boxShadow: enabled
            ? '0 20px 44px rgba(30, 150, 95, 0.34)'
            : '0 20px 44px rgba(44, 103, 220, 0.34)',
          bgcolor: enabled ? '#11875c' : '#205ac2',
        },
      }}
    >
      <Stack spacing={1.25} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <Box
          sx={{
            width: 62,
            height: 62,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(theme.palette.common.white, 0.18),
            border: `1px solid ${alpha(theme.palette.common.white, 0.22)}`,
          }}
        >
          <PowerSettingsNewRounded sx={{ fontSize: 34 }} />
        </Box>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 900, lineHeight: 1.15 }}>
            {enabled ? '关闭 PewPew 云' : '开启 PewPew 云'}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.75, opacity: 0.9 }}>
            {enabled ? '当前已开启' : '当前未开启'}
          </Typography>
        </Box>
      </Stack>
    </Button>
  )
}
