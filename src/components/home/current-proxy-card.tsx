import {
  RefreshRounded,
  SignalWifi0Bar as SignalNone,
  SignalWifi4Bar as SignalStrong,
} from '@mui/icons-material'
import {
  Box,
  Chip,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  SelectChangeEvent,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { EnhancedCard } from '@/components/home/enhanced-card'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import {
  useAppRefreshers,
  useCoreDataStatus,
  useProxiesData,
} from '@/providers/app-data-context'
import delayManager from '@/services/delay'
import { showNotice } from '@/services/notice-service'
import {
  PewPewProxyOption,
  resolvePewPewProxyGroup,
} from '@/utils/pewpew-client'

interface CurrentProxyCardProps {
  embedded?: boolean
  onDelayUpdated?: () => void
}

const DELAY_CHECK_INTERVAL = 60 * 1000
const DELAY_TIMEOUT = 5000

const getLineDelayValue = (proxy: PewPewProxyOption, groupName: string) => {
  const cached = delayManager.getDelayUpdate(proxy.name, groupName)
  if (cached && (cached.delay >= 0 || cached.delay === -2)) {
    return cached.delay
  }
  return delayManager.getDelayFix(proxy.record, groupName)
}

const formatLineDelay = (
  proxy: PewPewProxyOption,
  groupName: string,
  t: (key: string) => string,
) => {
  const delay = getLineDelayValue(proxy, groupName)
  if (delay === -2) {
    return { label: t('home.pewpew.delay.testing'), color: 'default' as const }
  }
  if (delay === 0 || delay >= 10000) {
    return {
      label: t('home.pewpew.delay.unavailable'),
      color: 'error' as const,
    }
  }
  if (delay > 0) {
    return {
      label: `${delayManager.formatDelay(delay)} ${t('home.pewpew.delay.unit')}`,
      color: delay < 400 ? ('success' as const) : ('warning' as const),
    }
  }
  return null
}

export const CurrentProxyCard = ({
  embedded = false,
  onDelayUpdated,
}: CurrentProxyCardProps) => {
  const theme = useTheme()
  const { t } = useTranslation()
  const { proxies } = useProxiesData()
  const { refreshProxy } = useAppRefreshers()
  const { isCoreDataPending } = useCoreDataStatus()
  const { current: currentProfile } = useProfiles()
  const lastDelayCheckAtRef = useRef<Record<string, number>>({})
  const [, forceDelayRender] = useReducer((value: number) => value + 1, 0)

  const { group, options } = useMemo(
    () => resolvePewPewProxyGroup(proxies),
    [proxies],
  )

  const currentLine = useMemo(() => {
    if (!group?.now) return null
    return options.find((item) => item.name === group.now) || null
  }, [group?.now, options])

  const selectedValue = currentLine?.name || ''
  const groupName = group?.name || ''

  const { changeProxy } = useProxySelection({
    onSuccess: () => {
      refreshProxy()
    },
    onError: (error) => {
      console.error('[PewPew] 线路切换失败:', error)
      showNotice.error(t('home.pewpew.connection.routeChangeFailed'))
      refreshProxy()
    },
  })

  const handleLineChange = (event: SelectChangeEvent<string>) => {
    const nextLine = event.target.value
    if (!groupName || !nextLine || nextLine === selectedValue) return

    changeProxy(groupName, nextLine, selectedValue)
  }

  const checkVisibleLineDelay = useCallback(
    async (force = false) => {
      if (!groupName || options.length === 0) return

      const now = Date.now()
      const lastCheckAt = lastDelayCheckAtRef.current[groupName] || 0
      if (!force && now - lastCheckAt < DELAY_CHECK_INTERVAL) return

      const names = options
        .filter((proxy) => {
          if (force) return true
          const cached = delayManager.getDelayUpdate(proxy.name, groupName)
          return !cached || now - cached.updatedAt > DELAY_CHECK_INTERVAL
        })
        .map((proxy) => proxy.name)

      if (names.length === 0) return

      lastDelayCheckAtRef.current[groupName] = now

      try {
        const delayTask = delayManager.checkListDelay(
          names,
          groupName,
          DELAY_TIMEOUT,
          6,
        )
        forceDelayRender()
        await delayTask
      } catch (error) {
        console.error('[PewPew] 线路延迟测试失败:', error)
      }
    },
    [groupName, options],
  )

  useEffect(() => {
    if (!groupName) return undefined

    delayManager.setGroupListener(groupName, () => {
      forceDelayRender()
      onDelayUpdated?.()
    })

    return () => {
      delayManager.removeGroupListener(groupName)
    }
  }, [groupName, onDelayUpdated])

  const content = (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <Stack spacing={0.25}>
        <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>
          {t('home.pewpew.connection.route')}
        </Typography>
      </Stack>

      {!currentProfile ? (
        <Box sx={{ textAlign: 'center', py: 2.25 }}>
          <Typography variant="body1" color="text.secondary">
            {t('home.pewpew.connection.importFirst')}
          </Typography>
        </Box>
      ) : isCoreDataPending ? (
        <Box sx={{ py: 2.25 }} />
      ) : !group || options.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 2.25 }}>
          <Typography variant="body1" color="text.secondary">
            {t('home.pewpew.connection.importFirst')}
          </Typography>
        </Box>
      ) : (
        <Stack direction="row" spacing={0.85} sx={{ alignItems: 'center' }}>
          <FormControl fullWidth size="small">
            <Select
              value={selectedValue}
              onChange={handleLineChange}
              onOpen={() => void checkVisibleLineDelay(false)}
              displayEmpty
              renderValue={(selected) =>
                selected ? (
                  selected
                ) : (
                  <Typography component="span" color="text.secondary">
                    {t('home.pewpew.connection.selectRoute')}
                  </Typography>
                )
              }
              sx={{
                height: 42,
                borderRadius: 2.5,
                bgcolor: alpha(theme.palette.background.paper, 0.72),
              }}
              MenuProps={{
                slotProps: {
                  paper: {
                    sx: {
                      maxHeight: 320,
                    },
                  },
                },
              }}
            >
              {options.map((proxy) => {
                const delay = formatLineDelay(proxy, groupName, t)
                return (
                  <MenuItem
                    key={proxy.name}
                    value={proxy.name}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 1,
                      minHeight: 40,
                      maxWidth: '100%',
                    }}
                  >
                    <Typography noWrap sx={{ minWidth: 0, flex: 1 }}>
                      {proxy.name}
                    </Typography>
                    {delay && (
                      <Chip
                        size="small"
                        label={delay.label}
                        color={delay.color}
                        sx={{ flexShrink: 0 }}
                      />
                    )}
                  </MenuItem>
                )
              })}
            </Select>
          </FormControl>
          <IconButton
            size="small"
            onClick={() => void checkVisibleLineDelay(true)}
            aria-label={t('home.pewpew.delay.refresh')}
            sx={(theme) => ({
              width: 34,
              height: 34,
              border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
              bgcolor: alpha(theme.palette.primary.main, 0.04),
            })}
          >
            <RefreshRounded sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
      )}
    </Stack>
  )

  if (embedded) {
    return content
  }

  return (
    <EnhancedCard
      title={t('home.pewpew.connection.route')}
      icon={
        <Box sx={{ color: currentLine ? 'success.main' : 'text.disabled' }}>
          {currentLine ? <SignalStrong /> : <SignalNone color="disabled" />}
        </Box>
      }
      iconColor={currentLine ? 'success' : 'info'}
    >
      {content}
    </EnhancedCard>
  )
}
