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
    if (!current) return '尚未导入线路'

    const updated = current.updated
      ? `上次更新时间：${dayjs(current.updated * 1000).format('YYYY-MM-DD HH:mm')}`
      : ''

    return updated || '当前状态：线路订阅已导入'
  }, [current])

  const setSyncingState = (value: boolean) => {
    setSyncing(value)
    onSyncingChange?.(value)
  }

  const refreshSubscription = async () => {
    await onProfileUpdated?.()
    const enhanced = await enhanceProfiles()
    if (!enhanced) {
      throw new Error('线路配置校验失败，请检查订阅链接或联系客服')
    }
    await onProfileUpdated?.()
    await refreshAll()
  }

  const closeNetworkBeforeSync = async () => {
    if (!networkEnabled && !networkConfigEnabled) return false

    setStatusText('已临时关闭 PewPew 云，正在更新线路...')
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
      setStatusText('请先粘贴订阅链接')
      return
    }

    if (!isSubscriptionUrl(url)) {
      setStatusText('订阅链接需要以 http:// 或 https:// 开头')
      return
    }

    setSyncingState(true)

    try {
      const closedNetwork = await closeNetworkBeforeSync()
      setStatusText(
        closedNetwork
          ? '已临时关闭 PewPew 云，正在更新线路...'
          : '正在导入线路...',
      )
      await importLineWithFallback(url)
      await refreshSubscription()
      setSubscriptionUrl('')
      setStatusText('线路导入成功，请点击“开启 PewPew 云”开始使用')
      showNotice.success('线路导入成功')
    } catch (err) {
      console.error('[PewPew] 线路导入失败:', err)
      setStatusText('线路导入失败，请检查订阅链接或联系客服')
      showNotice.error(err)
    } finally {
      setSyncingState(false)
    }
  })

  const handleUpdate = useLockFn(async () => {
    if (!current?.uid) {
      setStatusText('请先导入订阅链接')
      return
    }

    setSyncingState(true)

    try {
      const closedNetwork = await closeNetworkBeforeSync()
      setStatusText(
        closedNetwork
          ? '已临时关闭 PewPew 云，正在更新线路...'
          : '正在更新线路...',
      )
      await updateProfile(current.uid, current.option)
      await refreshSubscription()
      setStatusText('线路更新成功，请点击“开启 PewPew 云”开始使用')
      showNotice.success('线路更新成功')
    } catch (err) {
      console.error('[PewPew] 线路更新失败:', err)
      setStatusText('线路更新失败，请检查订阅链接或联系客服')
      showNotice.error(err)
    } finally {
      setSyncingState(false)
    }
  })

  const canImport = subscriptionUrl.trim().length > 0

  return (
    <Paper
      elevation={0}
      sx={(theme) => ({
        borderRadius: 4,
        p: { xs: 2, md: 2.5 },
        boxSizing: 'border-box',
        overflow: 'hidden',
        bgcolor:
          theme.palette.mode === 'light'
            ? alpha(theme.palette.common.white, 0.72)
            : alpha(theme.palette.background.paper, 0.78),
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
              线路订阅
            </Typography>
            <Typography variant="body2" color="text.secondary">
              粘贴链接后导入或更新线路
            </Typography>
          </Box>
        </Stack>

        <TextField
          fullWidth
          size="small"
          placeholder="粘贴订阅链接"
          value={subscriptionUrl}
          onChange={(event) => setSubscriptionUrl(event.target.value)}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 2.5,
              bgcolor: 'background.paper',
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
            导入线路
          </Button>
          <Button
            fullWidth
            variant="outlined"
            onClick={handleUpdate}
            disabled={!current?.uid || syncing}
            startIcon={<UpdateOutlined />}
            sx={{ borderRadius: 999, py: 1 }}
          >
            更新线路
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
