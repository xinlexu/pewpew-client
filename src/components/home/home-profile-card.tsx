import {
  CloudUploadOutlined,
  DescriptionOutlined,
  UpdateOutlined,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material'
import { listen, TauriEvent } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import yaml from 'js-yaml'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useAppRefreshers } from '@/providers/app-data-context'
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

interface HomeProfileCardProps {
  current: IProfileItem | null | undefined
  onProfileUpdated?: () => void | Promise<void>
  onSyncingChange?: (syncing: boolean) => void
}

const isSubscriptionUrl = (value: string) => /^https?:\/\//i.test(value)
const isYamlPath = (value: string) => /\.ya?ml$/i.test(value)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const getCreatedLocalProfile = (
  before: IProfilesConfig,
  after: IProfilesConfig,
) => {
  const beforeUids = new Set((before.items || []).map((item) => item.uid))
  return (after.items || [])
    .filter((item) => item.type === 'local' && !beforeUids.has(item.uid))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))[0]
}

type StatusMessage =
  | { type: 'empty' }
  | { type: 'key'; key: string }
  | { type: 'keys'; keys: string[] }

export const HomeProfileCard = ({
  current,
  onProfileUpdated,
  onSyncingChange,
}: HomeProfileCardProps) => {
  const { i18n, t } = useTranslation()
  const { refreshAll } = useAppRefreshers()
  const {
    indicator: networkEnabled,
    configState: networkConfigEnabled,
    setSystemProxyEnabled,
    invalidateProxyState,
  } = useSystemProxyState()
  const [subscriptionUrl, setSubscriptionUrl] = useState('')
  const [statusMessage, setStatusMessage] = useState<StatusMessage>({
    type: 'empty',
  })
  const [syncing, setSyncing] = useState(false)
  const [dragActive, setDragActive] = useState(false)
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
  }

  const closeNetworkBeforeSync = async (
    messageKey = 'home.pewpew.subscription.temporarilyStopped',
  ) => {
    if (!networkEnabled && !networkConfigEnabled) return false

    setStatusKey(messageKey)
    await setSystemProxyEnabled(false)
    await invalidateProxyState()
    return true
  }

  const importLineWithFallback = async (url: string) => {
    try {
      await importProfile(url)
    } catch (firstError) {
      console.warn('[PewPew] 线路导入失败，尝试备用方式:', firstError)
      await importProfile(url, {
        with_proxy: false,
        self_proxy: true,
      })
    }
  }

  const handleImport = useLockFn(async () => {
    const url = subscriptionUrl.trim()

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
      const closedNetwork = await closeNetworkBeforeSync()
      setStatusKey(
        closedNetwork
          ? 'home.pewpew.subscription.temporarilyStopped'
          : 'home.pewpew.subscription.importing',
      )
      await importLineWithFallback(url)
      await refreshSubscription()
      setSubscriptionUrl('')
      setStatusKey('home.pewpew.subscription.importSuccess')
      showNotice.success(t('home.pewpew.subscription.importSuccess'))
    } catch (err) {
      console.error('[PewPew] 线路导入失败:', err)
      setStatusKey('home.pewpew.subscription.importFailed')
      showNotice.error(t('home.pewpew.subscription.importFailed'))
    } finally {
      setSyncingState(false)
    }
  })

  const handleUpdate = useLockFn(async () => {
    if (!current?.uid) {
      setStatusKey('home.pewpew.connection.importFirst')
      return
    }

    setSyncingState(true)

    try {
      const closedNetwork = await closeNetworkBeforeSync()
      setStatusKey(
        closedNetwork
          ? 'home.pewpew.subscription.temporarilyStopped'
          : 'home.pewpew.subscription.updating',
      )
      await updateProfile(current.uid, current.option)
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
        const refreshedRoutes = resolvePewPewProxyGroup(refreshedProxies)
        if (refreshedRoutes.options.length === 0) {
          throw new Error('no-routes')
        }

        localStorage.setItem(PEWPEW_LAST_YAML_PROFILE_KEY, createdProfile.uid)
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
  })

  const canImport = subscriptionUrl.trim().length > 0

  useEffect(() => {
    let disposed = false
    const cleanups: Array<() => void> = []

    const setup = async () => {
      const unlistenEnter = await listen<{ paths?: string[] }>(
        TauriEvent.DRAG_ENTER,
        (event) => {
          const hasYaml = event.payload.paths?.some(isYamlPath)
          if (hasYaml) setYamlDragActive(true)
        },
      )
      cleanups.push(unlistenEnter)

      const unlistenDrop = await listen<{ paths?: string[] }>(
        TauriEvent.DRAG_DROP,
        (event) => {
          if (disposed || !dragActiveRef.current) return
          const firstYaml = event.payload.paths?.find(isYamlPath)
          if (firstYaml) {
            void importYamlFileFromPath(firstYaml, 'drop')
          } else {
            setStatusKey('home.pewpew.subscription.yamlOnly')
            showNotice.error(t('home.pewpew.subscription.yamlOnly'))
          }
          dragDepthRef.current = 0
          setYamlDragActive(false)
        },
      )
      cleanups.push(unlistenDrop)

      const unlistenLeave = await listen(TauriEvent.DRAG_LEAVE, () => {
        dragDepthRef.current = 0
        setYamlDragActive(false)
      })
      cleanups.push(unlistenLeave)
    }

    void setup()

    return () => {
      disposed = true
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [importYamlFileFromPath, t])

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

  return (
    <Paper
      className="pewpew-transition"
      elevation={0}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      sx={(theme) => ({
        borderRadius: 4,
        p: { xs: 2, md: 2.5 },
        boxSizing: 'border-box',
        overflow: 'hidden',
        bgcolor: 'var(--pewpew-panel-muted)',
        border: `1px solid ${
          dragActive
            ? alpha(theme.palette.primary.main, 0.48)
            : alpha(theme.palette.primary.main, 0.08)
        }`,
        boxShadow: dragActive
          ? `0 18px 44px ${alpha(theme.palette.primary.main, 0.16)}`
          : theme.palette.mode === 'light'
            ? '0 12px 34px rgba(40, 70, 120, 0.06)'
            : '0 12px 34px rgba(0, 0, 0, 0.18)',
      })}
    >
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 850 }}>
              {t('home.pewpew.subscription.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('home.pewpew.subscription.description')}
            </Typography>
          </Box>
        </Stack>

        <TextField
          fullWidth
          size="small"
          placeholder={t('home.pewpew.subscription.placeholder')}
          value={subscriptionUrl}
          onChange={(event) => setSubscriptionUrl(event.target.value)}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 2.5,
              bgcolor: 'var(--pewpew-input-bg)',
            },
          }}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            fullWidth
            variant="contained"
            onClick={handleImport}
            disabled={!canImport || syncing}
            startIcon={<CloudUploadOutlined />}
            sx={{ borderRadius: 999, py: 1 }}
          >
            {t('home.pewpew.subscription.import')}
          </Button>
          <Button
            fullWidth
            variant="outlined"
            onClick={handleUpdate}
            disabled={!current?.uid || syncing}
            startIcon={<UpdateOutlined />}
            sx={{ borderRadius: 999, py: 1 }}
          >
            {t('home.pewpew.subscription.update')}
          </Button>
        </Stack>

        <Divider />

        <Box
          sx={(theme) => ({
            borderRadius: 3,
            border: `1px dashed ${
              dragActive
                ? theme.palette.primary.main
                : alpha(theme.palette.primary.main, 0.22)
            }`,
            bgcolor: dragActive
              ? alpha(theme.palette.primary.main, 0.1)
              : alpha(theme.palette.primary.main, 0.035),
            p: 1.35,
            transition: 'background-color 180ms ease, border-color 180ms ease',
          })}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.25}
            sx={{
              alignItems: { xs: 'stretch', sm: 'center' },
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>
                {t('home.pewpew.subscription.localFile')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {dragActive
                  ? t('home.pewpew.subscription.dropYaml')
                  : t('home.pewpew.subscription.yamlSupport')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('home.pewpew.subscription.orImportYaml')}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              onClick={handleImportYaml}
              disabled={syncing}
              startIcon={<DescriptionOutlined />}
              sx={{
                borderRadius: 999,
                py: 1,
                px: 2,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {t('home.pewpew.subscription.importYaml')}
            </Button>
          </Stack>
        </Box>

        <Box>
          <Typography variant="body2" color="text.secondary">
            {statusText || currentStatus}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  )
}
