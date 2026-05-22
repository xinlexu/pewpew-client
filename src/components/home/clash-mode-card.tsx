import { Box, Chip, Stack, Typography, alpha, useTheme } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
} from '@/providers/app-data-context'
import { patchClashMode } from '@/services/cmds'

const CLASH_MODES = ['rule', 'global', 'direct'] as const
type ClashMode = (typeof CLASH_MODES)[number]
const VISIBLE_CLASH_MODES: ClashMode[] = ['rule', 'global']

const isClashMode = (mode: string): mode is ClashMode =>
  (CLASH_MODES as readonly string[]).includes(mode)

const MODE_META: Record<
  ClashMode,
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
  direct: {
    labelKey: 'home.components.clashMode.labels.direct',
    descriptionKey: 'home.components.clashMode.descriptions.direct',
  },
}

export const ClashModeCard = () => {
  const theme = useTheme()
  const { i18n, t } = useTranslation()
  const { verge } = useVerge()
  const { clashConfig } = useClashConfigData()
  const { refreshClashConfig } = useAppRefreshers()

  // 支持的模式列表
  const modeList = VISIBLE_CLASH_MODES

  // 直接使用API返回的模式，不维护本地状态
  const currentMode = clashConfig?.mode?.toLowerCase()
  const currentModeKey =
    typeof currentMode === 'string' && isClashMode(currentMode)
      ? currentMode
      : undefined
  const visibleModeKey =
    currentModeKey === 'direct' ? undefined : currentModeKey

  // 切换模式的处理函数
  const onChangeMode = useLockFn(async (mode: ClashMode) => {
    if (mode === currentModeKey) return
    if (verge?.auto_close_connection) {
      closeAllConnections()
    }

    try {
      await patchClashMode(mode)
      // 使用共享的刷新方法
      refreshClashConfig()
    } catch (error) {
      console.error('Failed to change mode:', error)
    }
  })

  // 按钮样式
  const buttonStyles = (mode: ClashMode) => ({
    cursor: 'pointer',
    px: 1.35,
    py: 1.15,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 0.6,
    minHeight: 90,
    minWidth: 0,
    boxSizing: 'border-box',
    bgcolor:
      mode === visibleModeKey
        ? 'primary.main'
        : alpha(theme.palette.primary.main, 0.055),
    color: mode === visibleModeKey ? 'primary.contrastText' : 'text.primary',
    border: `1px solid ${
      mode === visibleModeKey
        ? alpha(theme.palette.primary.main, 0.1)
        : alpha(theme.palette.primary.main, 0.08)
    }`,
    borderRadius: 3,
    position: 'relative',
    overflow: 'hidden',
    '&:hover': {
      transform: 'translateY(-1px)',
      bgcolor:
        mode === visibleModeKey
          ? 'primary.dark'
          : alpha(theme.palette.primary.main, 0.09),
    },
    '&:active': {
      transform: 'translateY(1px)',
    },
  })

  return (
    <Stack spacing={1.25} sx={{ width: '100%', minWidth: 0 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 1,
          width: '100%',
          minWidth: 0,
        }}
      >
        {modeList.map((mode) => (
          <Box
            key={mode}
            role="button"
            aria-pressed={mode === visibleModeKey}
            tabIndex={0}
            onClick={() => onChangeMode(mode)}
            sx={buttonStyles(mode)}
          >
            <Box
              sx={{
                minWidth: 0,
                pr: mode === 'rule' ? 5.5 : 0,
                textAlign: 'left',
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 900,
                  lineHeight: 1.2,
                  overflowWrap: 'anywhere',
                }}
              >
                {t(MODE_META[mode].labelKey)}
              </Typography>
              {mode === 'rule' && (
                <Chip
                  size="small"
                  label={
                    i18n.language === 'en'
                      ? t('home.pewpew.connection.recommendedShort')
                      : t('home.pewpew.connection.recommended')
                  }
                  sx={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    height: 20,
                    fontSize: 11,
                    maxWidth: 64,
                    bgcolor:
                      mode === visibleModeKey
                        ? alpha(theme.palette.common.white, 0.18)
                        : alpha(theme.palette.success.main, 0.12),
                    color:
                      mode === visibleModeKey
                        ? 'inherit'
                        : theme.palette.success.main,
                    '& .MuiChip-label': {
                      px: 0.75,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  }}
                />
              )}
            </Box>
            <Typography
              variant="caption"
              sx={{
                opacity: mode === visibleModeKey ? 0.9 : 0.72,
                textAlign: 'left',
                lineHeight: 1.32,
                overflowWrap: 'anywhere',
              }}
            >
              {t(MODE_META[mode].descriptionKey)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Stack>
  )
}
