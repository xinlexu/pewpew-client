import {
  EventAvailableRounded,
  RestartAltRounded,
  TravelExploreRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  LinearProgress,
  Skeleton,
  Stack,
  Typography,
  alpha,
} from '@mui/material'
import dayjs from 'dayjs'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  brandColor,
  iconTileSx,
  insetPanelSx,
  isLightTheme,
  sectionLabelSx,
  toneTextColor,
} from '@/components/home/pewpew-ui'
import {
  PEWPEW_UNKNOWN_STATUS,
  type PewPewAccountEvaluation,
  type PewPewSubscriptionStatus,
  parseExpiryDate,
} from '@/utils/pewpew-client'

interface AccountSummaryProps {
  status: PewPewSubscriptionStatus
  evaluation: PewPewAccountEvaluation
  profile?: IProfileItem | null
  loading?: boolean
}

const GB = 1024 ** 3

const formatGb = (bytes: number) => {
  const value = bytes / GB
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '')} GB`
}

export const AccountSummary = ({
  status,
  evaluation,
  profile,
  loading = false,
}: AccountSummaryProps) => {
  const { i18n, t } = useTranslation()
  const isEnglish = i18n.language === 'en'

  if (evaluation.state === 'unknown') {
    if (!loading) return null
    return (
      <Box>
        <Typography variant="body2" sx={{ ...sectionLabelSx, mb: 0.75 }}>
          {t('home.pewpew.account.title')}
        </Typography>
        <Skeleton variant="rounded" height={78} sx={{ borderRadius: '16px' }} />
      </Box>
    )
  }

  const formatStatusValue = (value: string) => {
    if (value === PEWPEW_UNKNOWN_STATUS) {
      return t('home.pewpew.account.unavailable')
    }
    if (/(?:长期有效|lifetime|unlimited)/i.test(value)) {
      return t('home.pewpew.account.lifetime')
    }
    if (isEnglish) {
      return value.replace(/^(\d+)\s*天$/, (_, days) => `${days} days`)
    }
    return value
  }

  const extra = profile?.extra
  const total = extra?.total ?? 0
  const used = (extra?.upload ?? 0) + (extra?.download ?? 0)
  const usage = total > 0 ? Math.min(Math.max(used / total, 0), 1) : null

  const expiry = parseExpiryDate(status.expire)
  const daysLeft = expiry
    ? expiry.startOf('day').diff(dayjs().startOf('day'), 'day')
    : null

  // Expired and exhausted plans are explained next to the connect button.
  const alert =
    evaluation.state === 'expiringSoon'
      ? {
          severity: 'warning' as const,
          key: 'home.pewpew.account.expiringSoon',
        }
      : evaluation.state === 'dataLow'
        ? { severity: 'warning' as const, key: 'home.pewpew.account.lowData' }
        : null

  const items: Array<{
    key: string
    label: string
    value: string
    // Still unknown while route data loads; shown as a placeholder.
    pending?: boolean
    caption?: string
    icon: ReactNode
    tone?: 'warning' | 'error'
  }> = [
    {
      key: 'traffic',
      label: t('home.pewpew.account.remainingTraffic'),
      value: formatStatusValue(status.remainingTraffic),
      pending: status.remainingTraffic === PEWPEW_UNKNOWN_STATUS,
      icon: <TravelExploreRounded sx={{ fontSize: 14 }} />,
      tone: evaluation.dataExhausted
        ? 'error'
        : evaluation.dataLow
          ? 'warning'
          : undefined,
    },
    {
      key: 'reset',
      label: t('home.pewpew.account.nextReset'),
      value: formatStatusValue(status.nextReset),
      pending: status.nextReset === PEWPEW_UNKNOWN_STATUS,
      icon: <RestartAltRounded sx={{ fontSize: 14 }} />,
    },
    {
      key: 'expire',
      label: t('home.pewpew.account.expire'),
      value: formatStatusValue(status.expire),
      pending: status.expire === PEWPEW_UNKNOWN_STATUS,
      caption:
        daysLeft !== null && daysLeft >= 0
          ? t('home.pewpew.account.daysLeft', { count: daysLeft })
          : undefined,
      icon: <EventAvailableRounded sx={{ fontSize: 14 }} />,
      tone: evaluation.expired
        ? 'error'
        : evaluation.expiringSoon
          ? 'warning'
          : undefined,
    },
  ]

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" sx={{ ...sectionLabelSx, mb: 0.75 }}>
        {t('home.pewpew.account.title')}
      </Typography>
      <Box sx={[insetPanelSx, { px: 1.75, py: 1.5 }]}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 1.25,
          }}
        >
          {items.map((item) => (
            <Box key={item.key} sx={{ minWidth: 0 }}>
              <Stack
                direction="row"
                spacing={0.75}
                sx={{ alignItems: 'center', minWidth: 0 }}
              >
                <Box aria-hidden sx={(theme) => iconTileSx(theme, 20)}>
                  {item.icon}
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ fontWeight: 600 }}
                >
                  {item.label}
                </Typography>
              </Stack>
              {loading && item.pending ? (
                <Skeleton
                  variant="text"
                  width={56}
                  sx={{ mt: 0.35, fontSize: 16 }}
                />
              ) : (
                <Typography
                  sx={(theme) => ({
                    mt: 0.5,
                    fontSize: { xs: 15, sm: 17 },
                    fontWeight: 800,
                    lineHeight: 1.25,
                    overflowWrap: 'anywhere',
                    color: item.tone
                      ? toneTextColor(theme, item.tone)
                      : theme.palette.text.primary,
                  })}
                >
                  {item.value}
                </Typography>
              )}
              {item.caption && (
                <Typography variant="caption" color="text.secondary">
                  {item.caption}
                </Typography>
              )}
            </Box>
          ))}
        </Box>

        {usage !== null && (
          <Box sx={{ mt: 1.25 }}>
            <LinearProgress
              variant="determinate"
              value={usage * 100}
              aria-label={t('home.pewpew.account.usage')}
              color={
                evaluation.dataExhausted
                  ? 'error'
                  : evaluation.dataLow
                    ? 'warning'
                    : 'primary'
              }
              sx={(theme) => ({
                height: 6,
                borderRadius: 999,
                bgcolor: isLightTheme(theme)
                  ? alpha('#0f1e46', 0.08)
                  : alpha('#ffffff', 0.1),
                '& .MuiLinearProgress-bar': {
                  borderRadius: 999,
                  // Brand gradient while usage is healthy; plain tone colors warn.
                  ...(evaluation.dataExhausted || evaluation.dataLow
                    ? {}
                    : {
                        backgroundImage: `linear-gradient(90deg, #38bdf8, ${
                          isLightTheme(theme) ? '#6366f1' : brandColor(theme)
                        })`,
                      }),
                },
              })}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              sx={{ mt: 0.5 }}
            >
              {t('home.pewpew.account.usedOfTotal', {
                used: formatGb(used),
                total: formatGb(total),
              })}
            </Typography>
          </Box>
        )}
      </Box>

      {alert && (
        <Alert
          severity={alert.severity}
          variant="outlined"
          sx={{ mt: 1, borderRadius: '12px', py: 0.25 }}
        >
          {t(alert.key)}
        </Alert>
      )}
    </Box>
  )
}
