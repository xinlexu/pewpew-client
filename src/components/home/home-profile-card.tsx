import { CloudUploadOutlined, UpdateOutlined } from '@mui/icons-material'
import {
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useAppRefreshers } from '@/providers/app-data-context'
import { enhanceProfiles, importProfile, updateProfile } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

interface HomeProfileCardProps {
  current: IProfileItem | null | undefined
  onProfileUpdated?: () => void | Promise<void>
  onSyncingChange?: (syncing: boolean) => void
}

const isSubscriptionUrl = (value: string) => /^https?:\/\//i.test(value)

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
  const [statusText, setStatusText] = useState('')
  const [syncing, setSyncing] = useState(false)

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

  const refreshSubscription = async () => {
    await onProfileUpdated?.()
    const enhanced = await enhanceProfiles()
    if (!enhanced) {
      throw new Error('route enhancement failed')
    }
    await onProfileUpdated?.()
    await refreshAll()
  }

  const closeNetworkBeforeSync = async () => {
    if (!networkEnabled && !networkConfigEnabled) return false

    setStatusText(t('home.pewpew.subscription.temporarilyStopped'))
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
      setStatusText(t('home.pewpew.subscription.pasteFirst'))
      return
    }

    if (!isSubscriptionUrl(url)) {
      setStatusText(t('home.pewpew.subscription.invalidUrl'))
      return
    }

    setSyncingState(true)

    try {
      const closedNetwork = await closeNetworkBeforeSync()
      setStatusText(
        closedNetwork
          ? t('home.pewpew.subscription.temporarilyStopped')
          : t('home.pewpew.subscription.importing'),
      )
      await importLineWithFallback(url)
      await refreshSubscription()
      setSubscriptionUrl('')
      setStatusText(t('home.pewpew.subscription.importSuccess'))
      showNotice.success(t('home.pewpew.subscription.importSuccess'))
    } catch (err) {
      console.error('[PewPew] 线路导入失败:', err)
      setStatusText(t('home.pewpew.subscription.importFailed'))
      showNotice.error(t('home.pewpew.subscription.importFailed'))
    } finally {
      setSyncingState(false)
    }
  })

  const handleUpdate = useLockFn(async () => {
    if (!current?.uid) {
      setStatusText(t('home.pewpew.connection.importFirst'))
      return
    }

    setSyncingState(true)

    try {
      const closedNetwork = await closeNetworkBeforeSync()
      setStatusText(
        closedNetwork
          ? t('home.pewpew.subscription.temporarilyStopped')
          : t('home.pewpew.subscription.updating'),
      )
      await updateProfile(current.uid, current.option)
      await refreshSubscription()
      setStatusText(t('home.pewpew.subscription.updateSuccess'))
      showNotice.success(t('home.pewpew.subscription.updateSuccess'))
    } catch (err) {
      console.error('[PewPew] 线路更新失败:', err)
      setStatusText(t('home.pewpew.subscription.updateFailed'))
      showNotice.error(t('home.pewpew.subscription.updateFailed'))
    } finally {
      setSyncingState(false)
    }
  })

  const canImport = subscriptionUrl.trim().length > 0

  return (
    <Paper
      className="pewpew-transition"
      elevation={0}
      sx={(theme) => ({
        borderRadius: 4,
        p: { xs: 2, md: 2.5 },
        boxSizing: 'border-box',
        overflow: 'hidden',
        bgcolor: 'var(--pewpew-panel-muted)',
        border: `1px solid ${alpha(theme.palette.primary.main, 0.08)}`,
        boxShadow:
          theme.palette.mode === 'light'
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

        <Box>
          <Typography variant="body2" color="text.secondary">
            {statusText || currentStatus}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  )
}
