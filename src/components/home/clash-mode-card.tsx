import { InfoOutlined } from '@mui/icons-material'
import {
  Box,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import {
  sectionLabelSx,
  segmentedControlSx,
  toneTextColor,
} from '@/components/home/pewpew-ui'
import { useRouteGuard } from '@/hooks/use-route-guard'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import { patchClashMode } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { resolvePewPewProxyGroup } from '@/utils/pewpew-client'

const CLASH_MODES = ['rule', 'global', 'direct'] as const
type ClashMode = (typeof CLASH_MODES)[number]
const VISIBLE_CLASH_MODES = ['rule', 'global'] as const
type VisibleClashMode = (typeof VISIBLE_CLASH_MODES)[number]

const isClashMode = (mode: string): mode is ClashMode =>
  (CLASH_MODES as readonly string[]).includes(mode)

const MODE_META: Record<
  VisibleClashMode,
  { labelKey: string; descriptionKey: string }
> = {
  rule: {
    labelKey: 'home.pewpew.connection.smartMode',
    descriptionKey: 'home.pewpew.connection.smartModeDescription',
  },
  global: {
    labelKey: 'home.pewpew.connection.globalMode',
    descriptionKey: 'home.pewpew.connection.globalModeDescription',
  },
}

interface ClashModeCardProps {
  disabled?: boolean
}

export const ClashModeCard = ({ disabled = false }: ClashModeCardProps) => {
  const { t } = useTranslation()
  const { verge } = useVerge()
  const { clashConfig } = useClashConfigData()
  const { proxies } = useProxiesData()
  const { refreshClashConfig } = useAppRefreshers()
  const { ensureValidRoute } = useRouteGuard()
  const {
    mutateAsync: onChangeMode,
    isPending,
    variables,
  } = useMutation({
    mutationKey: ['pewpewRoutes', 'mode'],
    mutationFn: async (mode: VisibleClashMode) => {
      const preferred = resolvePewPewProxyGroup(
        proxies,
        clashConfig?.mode,
      ).currentName
      try {
        // Prepare the target group before making it carry live traffic.
        if (!(await ensureValidRoute({ mode, preferred }))) return
        await patchClashMode(mode)
        if (verge?.auto_close_connection) {
          await closeAllConnections().catch(() => {})
        }
      } catch (error) {
        console.error('Failed to change mode:', error)
        showNotice.error(t('home.pewpew.connection.modeChangeFailed'))
      } finally {
        await refreshClashConfig().catch(() => {})
      }
    },
  })
  const pendingMode = isPending ? variables : null

  // 直接使用API返回的模式，不维护本地状态
  const currentMode = clashConfig?.mode?.toLowerCase()
  const currentModeKey =
    typeof currentMode === 'string' && isClashMode(currentMode)
      ? currentMode
      : undefined
  const visibleModeKey =
    currentModeKey === 'direct' ? null : (currentModeKey ?? null)
  const shownMode = pendingMode ?? visibleModeKey

  return (
    <Box sx={{ width: '100%', minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', mb: 0.75, minHeight: 22 }}
      >
        <Typography variant="body2" sx={sectionLabelSx}>
          {t('home.pewpew.connection.mode')}
        </Typography>
        {pendingMode && <CircularProgress size={12} thickness={5} />}
      </Stack>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        value={shownMode}
        disabled={disabled || !!pendingMode || !currentModeKey}
        aria-label={t('home.pewpew.connection.mode')}
        onChange={(_, value: VisibleClashMode | null) => {
          if (value && value !== currentModeKey && !disabled && !isPending) {
            void onChangeMode(value)
          }
        }}
        sx={segmentedControlSx}
      >
        {VISIBLE_CLASH_MODES.map((mode) => (
          <ToggleButton key={mode} value={mode}>
            {t(MODE_META[mode].labelKey)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {currentModeKey === 'direct' ? (
        <Stack
          direction="row"
          spacing={0.75}
          sx={(theme) => ({
            mt: 0.75,
            alignItems: 'flex-start',
            color: toneTextColor(theme, 'warning'),
          })}
        >
          <InfoOutlined sx={{ fontSize: 16, mt: '1px' }} />
          <Typography variant="caption" sx={{ lineHeight: 1.45 }}>
            {t('home.pewpew.connection.directModeHint')}
          </Typography>
        </Stack>
      ) : (
        shownMode && (
          <Typography
            variant="caption"
            color="text.secondary"
            component="p"
            sx={{ mt: 0.75, lineHeight: 1.45 }}
          >
            {t(MODE_META[shownMode].descriptionKey)}
          </Typography>
        )
      )}
    </Box>
  )
}
