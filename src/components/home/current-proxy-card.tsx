import {
  NetworkCheckRounded,
  SignalWifi0Bar as SignalNone,
  SignalWifi4Bar as SignalStrong,
  SortRounded,
} from '@mui/icons-material'
import {
  Box,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  ListSubheader,
  MenuItem,
  Select,
  SelectChangeEvent,
  Skeleton,
  Stack,
  Typography,
  Tooltip,
  alpha,
  useTheme,
} from '@mui/material'
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { EnhancedCard } from '@/components/home/enhanced-card'
import {
  glassFieldSx,
  glassMenuPaperSx,
  isLightTheme,
  sectionLabelSx,
  toneTextColor,
} from '@/components/home/pewpew-ui'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import {
  useAppRefreshers,
  useClashConfigData,
  useCoreDataStatus,
  useProxiesData,
} from '@/providers/app-data-context'
import delayManager from '@/services/delay'
import { showNotice } from '@/services/notice-service'
import {
  PewPewProxyOption,
  resolvePewPewProxyGroup,
} from '@/utils/pewpew-client'
import {
  arrangeRoutes,
  regionFlag,
  regionName,
  type RouteSection,
  type RouteSort,
} from '@/utils/route-health'

interface CurrentProxyCardProps {
  embedded?: boolean
  disabled?: boolean
  // Profiles or route data are still loading; show a placeholder.
  loading?: boolean
  routeBlocked?: boolean
  routeBlockedText?: string
  onDelayUpdated?: () => void
}

const DELAY_CHECK_INTERVAL = 60 * 1000
const DELAY_TIMEOUT = 5000
const ROUTE_SORT_KEY = 'pewpew-route-sort'

const readRouteSort = (): RouteSort => {
  try {
    return localStorage.getItem(ROUTE_SORT_KEY) === 'delay'
      ? 'delay'
      : 'default'
  } catch {
    return 'default'
  }
}

const writeRouteSort = (sort: RouteSort) => {
  try {
    localStorage.setItem(ROUTE_SORT_KEY, sort)
  } catch {}
}

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
  disabled = false,
  loading = false,
  routeBlocked = false,
  routeBlockedText,
  onDelayUpdated,
}: CurrentProxyCardProps) => {
  const theme = useTheme()
  const { t, i18n } = useTranslation()
  const { proxies } = useProxiesData()
  const { clashConfig } = useClashConfigData()
  const { refreshProxy } = useAppRefreshers()
  const { isCoreDataPending } = useCoreDataStatus()
  const { current: currentProfile } = useProfiles()
  const lastDelayCheckAtRef = useRef<Record<string, number>>({})
  const [, forceDelayRender] = useReducer((value: number) => value + 1, 0)
  const [testing, setTesting] = useState(false)
  const [sort, setSort] = useState<RouteSort>(readRouteSort)
  // Order shown while the menu is open, so results arriving from a delay test
  // update the chips without moving rows under the pointer.
  const [frozenOrder, setFrozenOrder] = useState<RouteSection[] | null>(null)

  const { group, options, currentName } = useMemo(
    () => resolvePewPewProxyGroup(proxies, clashConfig?.mode),
    [proxies, clashConfig?.mode],
  )

  const currentLine = useMemo(() => {
    return options.find((item) => item.name === currentName) || null
  }, [currentName, options])

  const selectedValue = currentLine?.name || ''
  const groupName = group?.name || ''

  // Sorting uses the last finished test, so routes being tested again keep
  // their place instead of dropping to the end.
  const arrange = useCallback(
    (by: RouteSort) =>
      arrangeRoutes(options, by, (option) => {
        const cached = delayManager.getDelayUpdate(option.name, groupName)
        if (cached && cached.delay > 0) return cached.delay
        return option.record.history?.at(-1)?.delay ?? null
      }),
    [groupName, options],
  )

  // Rebuild the frozen order with the current route objects; routes added
  // since the menu opened go last.
  const sections = useMemo(() => {
    if (!frozenOrder) return arrange(sort)
    const byName = new Map(options.map((option) => [option.name, option]))
    const seen = new Set<string>()
    const result = frozenOrder
      .map((section) => ({
        region: section.region,
        options: section.options
          .map((option) => byName.get(option.name))
          .filter((option): option is PewPewProxyOption => {
            if (!option) return false
            seen.add(option.name)
            return true
          }),
      }))
      .filter((section) => section.options.length > 0)
    const added = options.filter((option) => !seen.has(option.name))
    if (added.length) result.push({ region: null, options: added })
    return result
  }, [arrange, frozenOrder, options, sort])

  const toggleSort = () => {
    const next: RouteSort = sort === 'delay' ? 'default' : 'delay'
    writeRouteSort(next)
    setSort(next)
    setFrozenOrder(null)
  }

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

    const option = options.find((item) => item.name === nextLine)
    if (!option?.selectionPath?.length) return
    changeProxy(groupName, nextLine, selectedValue, false, option.selectionPath)
  }

  const checkVisibleLineDelay = useCallback(
    async (force = false) => {
      if (routeBlocked || !groupName || options.length === 0) return

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
      setTesting(true)

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
      } finally {
        setTesting(false)
      }
    },
    [groupName, options, routeBlocked],
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

  const selectSx = {
    ...glassFieldSx(theme),
    height: 46,
    '& .MuiSelect-select': {
      display: 'flex',
      alignItems: 'center',
      minWidth: 0,
    },
  }

  const delayChipSx = {
    flexShrink: 0,
    height: 22,
    fontWeight: 700,
    bgcolor: isLightTheme(theme)
      ? alpha('#ffffff', 0.7)
      : alpha('#ffffff', 0.04),
    // Palette greens and ambers are too light for small text on white glass.
    ...(isLightTheme(theme) && {
      '&.MuiChip-colorSuccess': {
        color: '#0b7a50',
        borderColor: alpha('#0b7a50', 0.45),
      },
      '&.MuiChip-colorWarning': {
        color: toneTextColor(theme, 'warning'),
        borderColor: alpha(toneTextColor(theme, 'warning'), 0.45),
      },
      '&.MuiChip-colorError': {
        color: toneTextColor(theme, 'error'),
        borderColor: alpha(toneTextColor(theme, 'error'), 0.45),
      },
    }),
  }

  const subheaderSx = {
    display: 'flex',
    justifyContent: 'space-between',
    lineHeight: '30px',
    px: 2,
    fontSize: 12,
    fontWeight: 700,
    color: 'text.secondary',
    // Opaque enough that rows scrolling underneath stay hidden.
    bgcolor: isLightTheme(theme)
      ? alpha('#f4f7ff', 0.96)
      : alpha('#1b2440', 0.98),
  }

  const selectedDelay = currentLine
    ? formatLineDelay(currentLine, groupName, t)
    : null

  const content = (
    <Stack spacing={0.75} sx={{ minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 22,
        }}
      >
        <Typography variant="body2" sx={sectionLabelSx}>
          {t('home.pewpew.connection.route')}
        </Typography>
        {!routeBlocked && group && options.length > 0 && (
          <Stack direction="row" spacing={0.25}>
            {options.length > 1 && (
              <Tooltip
                title={t(
                  sort === 'delay'
                    ? 'home.pewpew.route.sortByOrder'
                    : 'home.pewpew.route.sortByDelay',
                )}
              >
                <IconButton
                  size="small"
                  onClick={toggleSort}
                  aria-label={t('home.pewpew.route.sortByDelay')}
                  aria-pressed={sort === 'delay'}
                  disabled={disabled}
                  sx={{
                    width: 28,
                    height: 28,
                    color: sort === 'delay' ? 'primary.main' : 'text.secondary',
                  }}
                >
                  <SortRounded sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t('home.pewpew.delay.refresh')}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => void checkVisibleLineDelay(true)}
                  aria-label={t('home.pewpew.delay.refresh')}
                  disabled={testing || disabled}
                  sx={{ width: 28, height: 28, color: 'text.secondary' }}
                >
                  {testing ? (
                    <CircularProgress size={14} thickness={5} />
                  ) : (
                    <NetworkCheckRounded sx={{ fontSize: 18 }} />
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        )}
      </Stack>

      {loading ? (
        <Skeleton
          variant="rounded"
          height={46}
          sx={{ borderRadius: '14px' }}
          aria-label={t('home.pewpew.connectionStatus.loading')}
        />
      ) : !currentProfile ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1.25 }}>
          {t('home.pewpew.connection.importFirst')}
        </Typography>
      ) : isCoreDataPending && options.length === 0 ? (
        <Skeleton
          variant="rounded"
          height={46}
          sx={{ borderRadius: '14px' }}
          aria-label={t('home.pewpew.connectionStatus.loading')}
        />
      ) : routeBlocked ? (
        <FormControl fullWidth size="small">
          <Select
            value=""
            disabled
            displayEmpty
            renderValue={() => (
              <Typography
                component="span"
                noWrap
                sx={{
                  color: toneTextColor(theme, 'error'),
                  // Disabled inputs force a grey text fill; keep the warning red.
                  WebkitTextFillColor: toneTextColor(theme, 'error'),
                  fontWeight: 600,
                }}
              >
                {routeBlockedText || t('home.pewpew.connection.selectRoute')}
              </Typography>
            )}
            sx={selectSx}
          />
        </FormControl>
      ) : !group || options.length === 0 ? (
        <Typography
          variant="body2"
          sx={{ py: 1.25, color: toneTextColor(theme, 'warning') }}
        >
          {t('home.pewpew.connection.noAvailableRoutes')}
        </Typography>
      ) : (
        <FormControl fullWidth size="small">
          <Select
            value={selectedValue}
            onChange={handleLineChange}
            onOpen={() => {
              setFrozenOrder(arrange(sort))
              void checkVisibleLineDelay(false)
            }}
            onClose={() => setFrozenOrder(null)}
            disabled={disabled}
            displayEmpty
            inputProps={{ 'aria-label': t('home.pewpew.connection.route') }}
            renderValue={(selected) =>
              selected ? (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', minWidth: 0, width: '100%' }}
                >
                  <Typography
                    component="span"
                    noWrap
                    sx={{ minWidth: 0, flex: 1, fontWeight: 600 }}
                  >
                    {selected}
                  </Typography>
                  {selectedDelay && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={selectedDelay.label}
                      color={selectedDelay.color}
                      sx={delayChipSx}
                    />
                  )}
                </Stack>
              ) : (
                <Typography
                  component="span"
                  noWrap
                  sx={{ color: toneTextColor(theme, 'warning') }}
                >
                  {t('home.pewpew.connection.selectRoute')}
                </Typography>
              )
            }
            sx={selectSx}
            MenuProps={{
              slotProps: {
                paper: {
                  sx: [glassMenuPaperSx, { maxHeight: 340 }],
                },
              },
            }}
          >
            {sections.flatMap((section) => {
              const items = section.options.map((proxy) => {
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
                        variant="outlined"
                        label={delay.label}
                        color={delay.color}
                        sx={delayChipSx}
                      />
                    )}
                  </MenuItem>
                )
              })
              if (sections.length < 2) return items
              const label = section.region
                ? `${regionFlag(section.region)} ${regionName(section.region, i18n.language)}`
                : t('home.pewpew.route.otherRegion')
              return [
                <ListSubheader
                  key={`region-${section.region ?? 'other'}`}
                  sx={subheaderSx}
                >
                  <span>{label}</span>
                  <span>{section.options.length}</span>
                </ListSubheader>,
                ...items,
              ]
            })}
          </Select>
        </FormControl>
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
