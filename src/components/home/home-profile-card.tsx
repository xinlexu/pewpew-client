import {
  CloudSyncOutlined,
  CloudUploadOutlined,
  ClearRounded,
  ContentPasteRounded,
  DescriptionOutlined,
  ExpandMoreRounded,
  UpdateOutlined,
} from '@mui/icons-material'
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material'
import { listen, TauriEvent } from '@tauri-apps/api/event'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useLockFn, useMemoizedFn } from 'ahooks'
import dayjs from 'dayjs'
import yaml from 'js-yaml'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import pewpewLogo from '@/assets/pewpew-logo.jpg'
import {
  brandColor,
  glassFieldSx,
  glassOutlinedButtonSx,
  iconTileSx,
  isLightTheme,
  pillButtonSx,
  surfaceSx,
} from '@/components/home/pewpew-ui'
import {
  refreshConnectionState,
  useConnectionState,
} from '@/hooks/use-connection-state'
import {
  useAppRefreshers,
  useClashConfigData,
} from '@/providers/app-data-context'
import {
  calcuProxies,
  createProfile,
  enhanceProfiles,
  getProfiles,
  importProfile,
  patchProfilesConfig,
  updateProfile,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { queryClient } from '@/services/query-client'
import {
  PEWPEW_LAST_YAML_PROFILE_KEY,
  countDisplayRoutesFromConfig,
  resolvePewPewProxyGroup,
} from '@/utils/pewpew-client'
import {
  isSubscriptionUrl,
  normalizeSubscriptionUrlInput,
} from '@/utils/subscription-url'

interface HomeProfileCardProps {
  current: IProfileItem | null | undefined
  onProfileUpdated?: () => void | Promise<void>
  onSyncingChange?: (syncing: boolean) => void
  busy?: boolean
  // 'onboarding' shows the full import form for first-time users.
  variant?: 'onboarding' | 'compact'
}

const isYamlPath = (value: string) => /\.ya?ml$/i.test(value)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const getCreatedProfile = (
  before: IProfilesConfig,
  after: IProfilesConfig,
  type: IProfileItem['type'],
) => {
  const beforeUids = new Set((before.items || []).map((item) => item.uid))
  return (after.items || [])
    .filter((item) => item.type === type && !beforeUids.has(item.uid))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))[0]
}

const getCreatedLocalProfile = (
  before: IProfilesConfig,
  after: IProfilesConfig,
) => {
  return getCreatedProfile(before, after, 'local')
}

const getCreatedRemoteProfile = (
  before: IProfilesConfig,
  after: IProfilesConfig,
) => {
  return getCreatedProfile(before, after, 'remote')
}

type StatusMessage =
  | { type: 'empty' }
  | { type: 'key'; key: string }
  | { type: 'keys'; keys: string[] }

export const HomeProfileCard = ({
  current,
  onProfileUpdated,
  onSyncingChange,
  busy: externalBusy = false,
  variant = 'compact',
}: HomeProfileCardProps) => {
  const { i18n, t } = useTranslation()
  const { refreshAll } = useAppRefreshers()
  const { clashConfig } = useClashConfigData()
  const {
    enabled: networkEnabled,
    configured: networkConfigEnabled,
    setConnected,
    busy: connectionBusy,
  } = useConnectionState()
  const busy = externalBusy || connectionBusy
  const [subscriptionUrl, setSubscriptionUrl] = useState('')
  const [statusMessage, setStatusMessage] = useState<StatusMessage>({
    type: 'empty',
  })
  const [syncing, setSyncing] = useState(false)
  const syncingRef = useRef(false)
  const [dragActive, setDragActive] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const dragActiveRef = useRef(false)
  const dragDepthRef = useRef(0)

  const statusText = useMemo(() => {
    if (statusMessage.type === 'key') return t(statusMessage.key)
    if (statusMessage.type === 'keys') {
      return statusMessage.keys.map((key) => t(key)).join(' ')
    }
    return ''
  }, [statusMessage, t])

  const setStatusKey = (key: string) => {
    setStatusMessage({ type: 'key', key })
  }

  const setStatusKeys = (...keys: string[]) => {
    setStatusMessage({ type: 'keys', keys })
  }

  const currentStatus = useMemo(() => {
    if (!current) return t('home.pewpew.subscription.notImported')

    const updated = current.updated
      ? `${t('home.pewpew.subscription.lastUpdated')}${i18n.language === 'en' ? ': ' : '：'}${dayjs(
          current.updated * 1000,
        ).format('YYYY-MM-DD HH:mm')}`
      : ''

    return updated || t('home.pewpew.subscription.imported')
  }, [current, i18n.language, t])

  const setSyncingState = (value: boolean) => {
    syncingRef.current = value
    setSyncing(value)
    onSyncingChange?.(value)
  }

  const setYamlDragActive = (value: boolean) => {
    dragActiveRef.current = value
    setDragActive(value)
  }

  const refreshSubscription = async () => {
    await onProfileUpdated?.()
    const enhanced = await enhanceProfiles()
    if (!enhanced) {
      throw new Error('route enhancement failed')
    }
    await onProfileUpdated?.()
    await refreshAll()
    const refreshedProxies = await calcuProxies()
    queryClient.setQueryData(['getProxies'], refreshedProxies)
    if (
      resolvePewPewProxyGroup(refreshedProxies, clashConfig?.mode).options
        .length === 0
    ) {
      throw new Error('no-routes')
    }
  }

  const closeNetworkBeforeSync = async (
    messageKey = 'home.pewpew.subscription.temporarilyStopped',
  ) => {
    if (!networkEnabled && !networkConfigEnabled) return false

    setStatusKey(messageKey)
    await setConnected(false)
    await refreshConnectionState()
    return true
  }

  const importLineWithFallback = async (url: string) => {
    try {
      await importProfile(url)
    } catch (firstError) {
      console.warn('[PewPew] 线路导入失败，尝试备用方式:', firstError)
      try {
        await importProfile(url, { with_proxy: false, self_proxy: true })
      } catch {
        await importProfile(url, { with_proxy: true, self_proxy: false })
      }
    }
  }

  const handlePasteSubscription = useLockFn(async () => {
    try {
      const text = await readText()
      const nextUrl = normalizeSubscriptionUrlInput(text)

      if (!nextUrl) {
        setStatusKey('home.pewpew.subscription.pasteFirst')
        return
      }

      setSubscriptionUrl(nextUrl)
      setStatusMessage({ type: 'empty' })

      if (!isSubscriptionUrl(nextUrl)) {
        setStatusKey('home.pewpew.subscription.invalidUrl')
      }
    } catch (err) {
      console.warn('[PewPew] 剪贴板读取失败:', err)
      setStatusKey('home.pewpew.subscription.pasteFirst')
    }
  })

  const handleSubscriptionPaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      const pastedText = event.clipboardData.getData('text')
      const nextUrl = normalizeSubscriptionUrlInput(pastedText)

      if (!nextUrl || nextUrl === pastedText) return

      event.preventDefault()
      setSubscriptionUrl(nextUrl)
      setStatusMessage({ type: 'empty' })
    },
    [],
  )

  const handleImport = useLockFn(async () => {
    if (busy || syncingRef.current) return
    const url = normalizeSubscriptionUrlInput(subscriptionUrl)
    if (url !== subscriptionUrl) setSubscriptionUrl(url)

    if (!url) {
      setStatusKey('home.pewpew.subscription.pasteFirst')
      return
    }

    if (!isSubscriptionUrl(url)) {
      setStatusKey('home.pewpew.subscription.invalidUrl')
      return
    }

    setSyncingState(true)

    try {
      setStatusKey('home.pewpew.subscription.importing')
      const beforeProfiles = await getProfiles()
      await importLineWithFallback(url)
      const afterProfiles = await getProfiles()
      const createdProfile = getCreatedRemoteProfile(
        beforeProfiles,
        afterProfiles,
      )
      if (!createdProfile?.uid) {
        throw new Error('remote-profile-not-found')
      }

      await closeNetworkBeforeSync()
      const switched = await patchProfilesConfig({
        current: createdProfile.uid,
      } as IProfilesConfig)
      if (!switched) {
        throw new Error('profile-switch-failed')
      }

      await refreshSubscription()
      setSubscriptionUrl('')
      setStatusKey('home.pewpew.subscription.importSuccess')
      showNotice.success(t('home.pewpew.subscription.importSuccess'))
    } catch (err) {
      console.error('[PewPew] 线路导入失败:', err)
      const key =
        err instanceof Error && err.message === 'no-routes'
          ? 'home.pewpew.connection.noAvailableRoutes'
          : 'home.pewpew.subscription.importFailed'
      setStatusKey(key)
      showNotice.error(t(key))
    } finally {
      setSyncingState(false)
    }
  })

  const handleUpdate = useLockFn(async () => {
    if (busy || syncingRef.current || current?.type !== 'remote') return
    if (!current?.uid) {
      setStatusKey('home.pewpew.connection.importFirst')
      return
    }

    setSyncingState(true)

    try {
      setStatusKey('home.pewpew.subscription.updating')
      await updateProfile(current.uid, current.option)
      await closeNetworkBeforeSync()
      await refreshSubscription()
      setStatusKey('home.pewpew.subscription.updateSuccess')
      showNotice.success(t('home.pewpew.subscription.updateSuccess'))
    } catch (err) {
      console.error('[PewPew] 线路更新失败:', err)
      setStatusKey('home.pewpew.subscription.updateFailed')
      showNotice.error(t('home.pewpew.subscription.updateFailed'))
    } finally {
      setSyncingState(false)
    }
  })

  const importYamlText = useLockFn(
    async (fileData: string, source: 'dialog' | 'drop') => {
      if (busy || syncingRef.current) return
      setSyncingState(true)
      setStatusKey('home.pewpew.subscription.yamlImporting')

      try {
        const parsed = yaml.load(fileData)

        if (!isPlainObject(parsed) || Object.keys(parsed).length === 0) {
          throw new Error('invalid-yaml')
        }

        const hasProxyProviders = isPlainObject(parsed['proxy-providers'])
        const hasConfigSections =
          Array.isArray(parsed.proxies) ||
          Array.isArray(parsed['proxy-groups']) ||
          hasProxyProviders

        if (!hasConfigSections) {
          throw new Error('invalid-yaml')
        }

        const { routeCount } = countDisplayRoutesFromConfig(parsed)
        if (routeCount <= 0 && !hasProxyProviders) {
          throw new Error('no-routes')
        }

        const closedNetwork = await closeNetworkBeforeSync(
          'home.pewpew.subscription.yamlTemporarilyStopped',
        )
        setStatusKey(
          closedNetwork
            ? 'home.pewpew.subscription.yamlTemporarilyStopped'
            : 'home.pewpew.subscription.yamlImporting',
        )

        const beforeProfiles = await getProfiles()
        await createProfile(
          {
            type: 'local',
            name:
              i18n.language === 'en'
                ? 'PewPew Local Config'
                : 'PewPew 本地配置',
            desc: '',
            url: '',
            selected: [],
            option: {
              with_proxy: false,
              self_proxy: false,
            },
          },
          fileData,
        )

        const afterProfiles = await getProfiles()
        const createdProfile = getCreatedLocalProfile(
          beforeProfiles,
          afterProfiles,
        )
        if (!createdProfile?.uid) {
          throw new Error('local-profile-not-found')
        }

        queryClient.removeQueries({ queryKey: ['getProxies'] })
        queryClient.removeQueries({ queryKey: ['getClashConfig'] })
        queryClient.removeQueries({ queryKey: ['getProxyProviders'] })

        const switched = await patchProfilesConfig({
          current: createdProfile.uid,
        } as IProfilesConfig)
        if (!switched) {
          throw new Error('profile-switch-failed')
        }

        const enhanced = await enhanceProfiles()
        if (!enhanced) {
          throw new Error('route-enhancement-failed')
        }

        await onProfileUpdated?.()
        await refreshAll()

        const refreshedProxies = await calcuProxies()
        queryClient.setQueryData(['getProxies'], refreshedProxies)
        const refreshedRoutes = resolvePewPewProxyGroup(
          refreshedProxies,
          clashConfig?.mode,
        )
        if (refreshedRoutes.options.length === 0) {
          throw new Error('no-routes')
        }

        try {
          localStorage.setItem(PEWPEW_LAST_YAML_PROFILE_KEY, createdProfile.uid)
        } catch {
          // This optional diagnostic marker must not fail an applied import.
        }
        setStatusKeys(
          'home.pewpew.subscription.yamlSuccess',
          'home.pewpew.subscription.yamlSwitched',
        )
        showNotice.success(t('home.pewpew.subscription.yamlSuccess'))
      } catch (err) {
        const key =
          err instanceof Error && err.message === 'no-routes'
            ? 'home.pewpew.subscription.yamlNoRoutes'
            : 'home.pewpew.subscription.yamlFailed'
        console.error(`[PewPew] YAML import failed via ${source}`)
        setStatusKey(key)
        showNotice.error(t(key))
      } finally {
        setSyncingState(false)
      }
    },
  )

  const importYamlFileFromPath = useLockFn(
    async (filePath: string, source: 'dialog' | 'drop') => {
      if (!isYamlPath(filePath)) {
        setStatusKey('home.pewpew.subscription.yamlOnly')
        showNotice.error(t('home.pewpew.subscription.yamlOnly'))
        return
      }

      try {
        const fileData = await readTextFile(filePath)
        await importYamlText(fileData, source)
      } catch {
        console.error(`[PewPew] YAML file read failed via ${source}`)
        setStatusKey('home.pewpew.subscription.yamlFailed')
        showNotice.error(t('home.pewpew.subscription.yamlFailed'))
      }
    },
  )

  const importYamlDroppedFile = useLockFn(async (file: File) => {
    if (!isYamlPath(file.name)) {
      setStatusKey('home.pewpew.subscription.yamlOnly')
      showNotice.error(t('home.pewpew.subscription.yamlOnly'))
      return
    }

    try {
      const fileData = await file.text()
      await importYamlText(fileData, 'drop')
    } catch {
      console.error('[PewPew] Dropped YAML file read failed')
      setStatusKey('home.pewpew.subscription.yamlFailed')
      showNotice.error(t('home.pewpew.subscription.yamlFailed'))
    }
  })

  const handleImportYaml = useLockFn(async () => {
    if (busy || syncingRef.current) return
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'YAML',
            extensions: ['yaml', 'yml'],
          },
        ],
      })
      const filePath = Array.isArray(selected) ? selected[0] : selected
      if (!filePath) return

      if (typeof filePath !== 'string') {
        setStatusKey('home.pewpew.subscription.yamlFailed')
        showNotice.error(t('home.pewpew.subscription.yamlFailed'))
        return
      }

      await importYamlFileFromPath(filePath, 'dialog')
    } catch {
      setStatusKey('home.pewpew.subscription.yamlFailed')
      showNotice.error(t('home.pewpew.subscription.yamlFailed'))
    }
  })

  const canImport = subscriptionUrl.trim().length > 0

  // Stable wrappers keep the native drag listeners registered once instead of
  // re-subscribing on every render (each keystroke used to cost 6 IPC calls).
  const handleNativeDragEnter = useMemoizedFn((paths?: string[]) => {
    if (paths?.some(isYamlPath)) setYamlDragActive(true)
  })

  const handleNativeDrop = useMemoizedFn((paths?: string[]) => {
    if (syncingRef.current || !dragActiveRef.current) return
    const firstYaml = paths?.find(isYamlPath)
    if (firstYaml) {
      void importYamlFileFromPath(firstYaml, 'drop')
    } else {
      setStatusKey('home.pewpew.subscription.yamlOnly')
      showNotice.error(t('home.pewpew.subscription.yamlOnly'))
    }
    dragDepthRef.current = 0
    setYamlDragActive(false)
  })

  const handleNativeDragLeave = useMemoizedFn(() => {
    dragDepthRef.current = 0
    setYamlDragActive(false)
  })

  useEffect(() => {
    let disposed = false
    const cleanups: Array<() => void> = []

    const setup = async () => {
      const unlistenEnter = await listen<{ paths?: string[] }>(
        TauriEvent.DRAG_ENTER,
        (event) => handleNativeDragEnter(event.payload.paths),
      )
      cleanups.push(unlistenEnter)

      const unlistenDrop = await listen<{ paths?: string[] }>(
        TauriEvent.DRAG_DROP,
        (event) => {
          if (disposed) return
          handleNativeDrop(event.payload.paths)
        },
      )
      cleanups.push(unlistenDrop)

      const unlistenLeave = await listen(TauriEvent.DRAG_LEAVE, () =>
        handleNativeDragLeave(),
      )
      cleanups.push(unlistenLeave)
    }

    void setup()
      .then(() => {
        if (disposed) cleanups.forEach((cleanup) => cleanup())
      })
      .catch(() => {
        cleanups.forEach((cleanup) => cleanup())
      })

    return () => {
      disposed = true
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [handleNativeDragEnter, handleNativeDrop, handleNativeDragLeave])

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current += 1
    setYamlDragActive(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(dragDepthRef.current - 1, 0)
    if (dragDepthRef.current === 0) setYamlDragActive(false)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = syncing ? 'none' : 'copy'
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setYamlDragActive(false)
    if (syncing) return

    const files = Array.from(event.dataTransfer.files)
    const firstYaml = files.find((file) => isYamlPath(file.name))
    if (firstYaml) {
      void importYamlDroppedFile(firstYaml)
      return
    }

    const pathItem = Array.from(event.dataTransfer.items)
      .map((item) => item.getAsFile())
      .find((file): file is File => !!file && isYamlPath(file.name))
    if (pathItem) {
      void importYamlDroppedFile(pathItem)
      return
    }

    setStatusKey('home.pewpew.subscription.yamlOnly')
    showNotice.error(t('home.pewpew.subscription.yamlOnly'))
  }

  const isOnboarding = variant === 'onboarding'
  const isRemote = current?.type === 'remote'
  const showImportForm = isOnboarding || expanded || dragActive || !current
  const statusLine = statusText || currentStatus

  const dragHandlers = {
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
  }

  const importForm = (
    <Stack spacing={1.25}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          fullWidth
          size="small"
          placeholder={t('home.pewpew.subscription.placeholder')}
          value={subscriptionUrl}
          onChange={(event) => setSubscriptionUrl(event.target.value)}
          onPaste={handleSubscriptionPaste}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canImport) void handleImport()
          }}
          slotProps={{
            htmlInput: {
              'aria-label': t('home.pewpew.subscription.subscriptionLink'),
              spellCheck: false,
            },
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  {subscriptionUrl && (
                    <IconButton
                      size="small"
                      title={t('shared.actions.clear')}
                      aria-label={t('shared.actions.clear')}
                      disabled={syncing || busy}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setSubscriptionUrl('')}
                    >
                      <ClearRounded fontSize="inherit" />
                    </IconButton>
                  )}
                  <IconButton
                    size="small"
                    edge="end"
                    title={t('profiles.page.importForm.actions.paste')}
                    aria-label={t('profiles.page.importForm.actions.paste')}
                    disabled={syncing || busy}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      void handlePasteSubscription()
                    }}
                  >
                    <ContentPasteRounded fontSize="inherit" />
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          sx={(theme) => ({
            '& .MuiOutlinedInput-root': {
              ...glassFieldSx(theme),
              minHeight: 44,
            },
          })}
        />
        <Button
          variant="contained"
          onClick={handleImport}
          disabled={!canImport || syncing || busy}
          startIcon={
            syncing ? (
              <CircularProgress size={16} color="inherit" thickness={5} />
            ) : (
              <CloudUploadOutlined />
            )
          }
          sx={{
            ...pillButtonSx,
            flexShrink: 0,
            minWidth: 132,
            minHeight: 44,
            px: 2.5,
          }}
        >
          {t('home.pewpew.subscription.import')}
        </Button>
      </Stack>

      <Box
        sx={(theme) => {
          const brand = brandColor(theme)
          return {
            borderRadius: '16px',
            border: `1.5px dashed ${dragActive ? brand : alpha(brand, 0.3)}`,
            bgcolor: dragActive
              ? alpha(brand, 0.1)
              : isLightTheme(theme)
                ? alpha('#ffffff', 0.45)
                : alpha('#ffffff', 0.03),
            px: 1.5,
            py: 1.25,
            transition: 'background-color 180ms ease, border-color 180ms ease',
          }
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.25}
          sx={{
            alignItems: { xs: 'stretch', sm: 'center' },
            justifyContent: 'space-between',
          }}
        >
          <Stack
            direction="row"
            spacing={1.25}
            sx={{ alignItems: 'center', minWidth: 0 }}
          >
            <DescriptionOutlined
              sx={(theme) => ({ color: brandColor(theme), flexShrink: 0 })}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {dragActive
                  ? t('home.pewpew.subscription.dropYaml')
                  : t('home.pewpew.subscription.localFile')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('home.pewpew.subscription.yamlSupport')}
              </Typography>
            </Box>
          </Stack>
          <Button
            variant="outlined"
            size="small"
            onClick={handleImportYaml}
            disabled={syncing || busy}
            startIcon={<DescriptionOutlined />}
            sx={[glassOutlinedButtonSx, { flexShrink: 0, px: 2 }]}
          >
            {t('home.pewpew.subscription.importYaml')}
          </Button>
        </Stack>
      </Box>
    </Stack>
  )

  if (isOnboarding) {
    const steps = [
      t('home.pewpew.onboarding.stepPaste'),
      t('home.pewpew.onboarding.stepImport'),
      t('home.pewpew.onboarding.stepConnect'),
    ]

    return (
      <Box
        component="section"
        aria-labelledby="pewpew-onboarding-title"
        {...dragHandlers}
        sx={[
          surfaceSx('primary'),
          { px: { xs: 2, sm: 3 }, py: { xs: 2.5, sm: 3 } },
        ]}
      >
        <Stack spacing={2.5}>
          <Stack
            spacing={1.5}
            sx={{
              alignItems: 'center',
              textAlign: 'center',
              pt: { xs: 0.5, sm: 1 },
            }}
          >
            <Box
              component="img"
              src={pewpewLogo}
              alt=""
              sx={(theme) => ({
                width: 64,
                height: 64,
                borderRadius: '20px',
                objectFit: 'cover',
                boxShadow: isLightTheme(theme)
                  ? '0 14px 30px rgba(36, 87, 214, 0.3) !important'
                  : '0 14px 30px rgba(0, 0, 0, 0.45) !important',
              })}
            />
            <Box>
              <Typography
                id="pewpew-onboarding-title"
                variant="h5"
                component="h2"
                sx={{ fontWeight: 800, fontSize: { xs: 22, sm: 26 } }}
              >
                {t('home.pewpew.onboarding.title')}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.75 }}
              >
                {t('home.pewpew.onboarding.description')}
              </Typography>
            </Box>
          </Stack>

          <Stack
            component="ol"
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{
              m: 0,
              p: 0,
              listStyle: 'none',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {steps.map((step, index) => (
              <Stack
                key={step}
                component="li"
                direction="row"
                spacing={1}
                sx={(theme) => ({
                  alignItems: 'center',
                  minWidth: 0,
                  pl: 0.75,
                  pr: 1.5,
                  py: 0.6,
                  borderRadius: 999,
                  bgcolor: isLightTheme(theme)
                    ? alpha('#ffffff', 0.6)
                    : alpha('#ffffff', 0.05),
                  border: `1px solid ${
                    isLightTheme(theme)
                      ? alpha('#ffffff', 0.9)
                      : alpha('#ffffff', 0.08)
                  }`,
                })}
              >
                <Box
                  sx={(theme) => ({
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 800,
                    color: brandColor(theme),
                    bgcolor: alpha(brandColor(theme), 0.12),
                  })}
                >
                  {index + 1}
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {step}
                </Typography>
              </Stack>
            ))}
          </Stack>

          {importForm}

          {statusText && (
            <Typography variant="body2" color="text.secondary" role="status">
              {statusText}
            </Typography>
          )}
        </Stack>
      </Box>
    )
  }

  return (
    <Box
      component="section"
      aria-labelledby="pewpew-subscription-title"
      {...dragHandlers}
      sx={[surfaceSx('secondary'), { px: { xs: 2, sm: 2.5 }, py: 2 }]}
    >
      <Stack spacing={showImportForm ? 1.75 : 0}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{
            alignItems: { xs: 'stretch', sm: 'center' },
            justifyContent: 'space-between',
          }}
        >
          <Stack
            direction="row"
            spacing={1.25}
            sx={{ alignItems: 'center', minWidth: 0 }}
          >
            <Box aria-hidden sx={(theme) => iconTileSx(theme, 40)}>
              {isRemote ? <CloudSyncOutlined /> : <DescriptionOutlined />}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                id="pewpew-subscription-title"
                variant="subtitle1"
                component="h2"
                sx={{ fontWeight: 800, lineHeight: 1.3 }}
              >
                {isRemote
                  ? t('home.pewpew.subscription.title')
                  : t('home.pewpew.subscription.localFile')}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                role="status"
                sx={{ overflowWrap: 'anywhere' }}
              >
                {statusLine}
              </Typography>
            </Box>
          </Stack>

          <Stack
            direction="row"
            spacing={1}
            sx={{ flexShrink: 0, justifyContent: 'flex-end' }}
          >
            {isRemote && (
              <Button
                variant="outlined"
                onClick={handleUpdate}
                disabled={syncing || busy}
                startIcon={
                  syncing ? (
                    <CircularProgress size={16} thickness={5} />
                  ) : (
                    <UpdateOutlined />
                  )
                }
                sx={[glassOutlinedButtonSx, { px: 2 }]}
              >
                {t('home.pewpew.subscription.update')}
              </Button>
            )}
            <Button
              variant="text"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={showImportForm}
              endIcon={
                <ExpandMoreRounded
                  sx={{
                    transform: showImportForm ? 'rotate(180deg)' : 'none',
                    transition: 'transform 180ms ease',
                  }}
                />
              }
              sx={{ ...pillButtonSx, px: 1.5 }}
            >
              {t('home.pewpew.subscription.changeLink')}
            </Button>
          </Stack>
        </Stack>

        <Collapse in={showImportForm} timeout={200}>
          {importForm}
        </Collapse>
      </Stack>
    </Box>
  )
}
