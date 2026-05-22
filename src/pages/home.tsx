import {
  CloseRounded,
  EventAvailableRounded,
  InfoOutlined,
  RestartAltRounded,
  TravelExploreRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  Link,
  Paper,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import dayjs from 'dayjs'
import { useCallback, useReducer, useState } from 'react'

import pewpewLogo from '@/assets/pewpew-logo.jpg'
import { ClashModeCard } from '@/components/home/clash-mode-card'
import { CurrentProxyCard } from '@/components/home/current-proxy-card'
import { HomeProfileCard } from '@/components/home/home-profile-card'
import { ProxyTunCard } from '@/components/home/proxy-tun-card'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxiesData } from '@/providers/app-data-context'
import delayManager from '@/services/delay'
import {
  PewPewSubscriptionStatus,
  extractPewPewSubscriptionStatus,
  resolvePewPewProxyGroup,
} from '@/utils/pewpew-client'

const PEWPEW_BLUE = '#2869df'
const WECHAT_GREEN = '#07c160'

const HomePage = () => {
  const theme = useTheme()
  const { current, mutateProfiles } = useProfiles()
  const { proxies } = useProxiesData()
  const [lineSyncing, setLineSyncing] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [, refreshDelaySummary] = useReducer((value: number) => value + 1, 0)
  const subscriptionStatus = extractPewPewSubscriptionStatus(current, proxies)
  const isDark = theme.palette.mode === 'dark'

  const currentLineSummary = (() => {
    const { group, options } = resolvePewPewProxyGroup(proxies)
    if (!group?.now) return { name: '请选择线路', delayText: '' }

    const currentLine = options.find((item) => item.name === group.now)
    if (!currentLine) return { name: '请选择线路', delayText: '' }

    const cachedDelay = delayManager.getDelayUpdate(
      currentLine.name,
      group.name,
    )
    const delay =
      cachedDelay && cachedDelay.delay >= 0
        ? cachedDelay.delay
        : delayManager.getDelayFix(currentLine.record, group.name)
    const delayText =
      delay > 0 && delay < 10000 ? `${delayManager.formatDelay(delay)} ms` : ''

    return { name: currentLine.name, delayText }
  })()

  const handleDelayUpdated = useCallback(() => {
    refreshDelaySummary()
  }, [])

  return (
    <Box
      sx={{
        height: '100%',
        minHeight: '100%',
        overflow: 'auto',
        boxSizing: 'border-box',
        px: { xs: 2, md: 3 },
        py: { xs: 1.5, md: 2 },
        bgcolor: isDark ? '#151922' : '#f4f7fb',
        background: isDark
          ? 'radial-gradient(circle at 50% -10%, rgba(40,105,223,0.22), transparent 32%), linear-gradient(145deg, #151922 0%, #1d2430 52%, #171b24 100%)'
          : 'radial-gradient(circle at 50% -12%, rgba(40,105,223,0.16), transparent 34%), linear-gradient(145deg, #f4f7fb 0%, #eef5fb 48%, #f8fafc 100%)',
      }}
    >
      <Stack
        spacing={2}
        sx={{
          width: '100%',
          maxWidth: 1080,
          mx: 'auto',
          pb: 3,
          boxSizing: 'border-box',
        }}
      >
        <PewPewHeader onAbout={() => setAboutOpen(true)} />

        <MainConnectPanel
          currentLine={currentLineSummary}
          disabled={lineSyncing}
          status={subscriptionStatus}
        />

        <ConnectionSettingsCard onDelayUpdated={handleDelayUpdated} />

        <HomeProfileCard
          current={current}
          onProfileUpdated={mutateProfiles}
          onSyncingChange={setLineSyncing}
        />
      </Stack>

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </Box>
  )
}

const PewPewHeader = ({ onAbout }: { onAbout: () => void }) => {
  return (
    <Box
      component="header"
      data-tauri-drag-region="true"
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'center' },
        justifyContent: 'space-between',
        gap: 1.5,
        minHeight: 58,
      }}
    >
      <Stack
        direction="row"
        spacing={1.25}
        data-tauri-drag-region="true"
        sx={{ alignItems: 'center', minWidth: 0 }}
      >
        <Box
          component="img"
          src={pewpewLogo}
          alt="PewPew 云"
          data-tauri-drag-region="false"
          sx={{
            width: { xs: 150, sm: 180 },
            height: 54,
            objectFit: 'contain',
            objectPosition: 'left center',
            flexShrink: 0,
          }}
        />

        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 900,
              lineHeight: 1.12,
              fontSize: { xs: 20, sm: 24 },
            }}
          >
            PewPew 云客户端
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.35, fontWeight: 600 }}
          >
            选择线路后，点击开启即可使用
          </Typography>
        </Box>
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        data-tauri-drag-region="false"
        sx={{
          alignItems: 'center',
          justifyContent: { xs: 'space-between', sm: 'flex-end' },
          flexShrink: 0,
          flexWrap: 'wrap',
          width: { xs: '100%', sm: 'auto' },
        }}
      >
        <Stack
          direction="row"
          spacing={0.75}
          sx={(theme) => ({
            alignItems: 'center',
            px: 1.1,
            py: 0.65,
            borderRadius: 999,
            color: theme.palette.text.primary,
            bgcolor:
              theme.palette.mode === 'light'
                ? alpha(theme.palette.common.white, 0.78)
                : alpha(theme.palette.common.white, 0.08),
            border: `1px solid ${alpha(WECHAT_GREEN, 0.2)}`,
          })}
        >
          <Box
            sx={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: WECHAT_GREEN,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            <WeChatIcon />
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 800 }}>
            微信 PewPew_VPN
          </Typography>
        </Stack>

        <Button
          size="small"
          variant="text"
          color="inherit"
          startIcon={<InfoOutlined />}
          onClick={onAbout}
          sx={{ borderRadius: 999, px: 1.15, fontWeight: 700 }}
        >
          关于
        </Button>
      </Stack>
    </Box>
  )
}

const WeChatIcon = () => {
  return (
    <Box
      component="svg"
      viewBox="0 0 32 32"
      aria-hidden="true"
      sx={{ width: 17, height: 17, display: 'block' }}
    >
      <ellipse cx="13.2" cy="14.2" rx="7.8" ry="5.8" fill="#fff" />
      <path
        d="M8.6 19.1 6.8 22l3.6-1.5c.9.2 1.8.3 2.8.3 4.3 0 7.8-2.6 7.8-5.9S17.5 9 13.2 9s-7.8 2.6-7.8 5.9c0 1.6 1.2 3.1 3.2 4.2Z"
        fill="#fff"
      />
      <ellipse
        cx="19.8"
        cy="18.8"
        rx="6.8"
        ry="5.1"
        fill="#fff"
        opacity="0.92"
      />
      <path
        d="m23.9 22.6 2.9 1.2-1.5-2.4c.8-.8 1.3-1.8 1.3-2.9 0-2.8-3-5.1-6.8-5.1S13 15.7 13 18.5s3 5.1 6.8 5.1c1.5 0 2.9-.4 4.1-1Z"
        fill="#fff"
        opacity="0.92"
      />
      <circle cx="10.6" cy="13.9" r="0.9" fill={WECHAT_GREEN} />
      <circle cx="15.2" cy="13.9" r="0.9" fill={WECHAT_GREEN} />
      <circle cx="17.7" cy="18.4" r="0.75" fill={WECHAT_GREEN} />
      <circle cx="21.4" cy="18.4" r="0.75" fill={WECHAT_GREEN} />
    </Box>
  )
}

const MainConnectPanel = ({
  currentLine,
  disabled,
  status,
}: {
  currentLine: { name: string; delayText: string }
  disabled: boolean
  status: PewPewSubscriptionStatus
}) => {
  return (
    <Paper
      elevation={0}
      sx={(theme) => ({
        borderRadius: 5,
        px: { xs: 2, md: 3 },
        py: { xs: 2.25, md: 3 },
        boxSizing: 'border-box',
        overflow: 'hidden',
        bgcolor:
          theme.palette.mode === 'light'
            ? alpha(theme.palette.common.white, 0.92)
            : alpha(theme.palette.background.paper, 0.9),
        border: `1px solid ${alpha(PEWPEW_BLUE, 0.1)}`,
        boxShadow:
          theme.palette.mode === 'light'
            ? '0 26px 80px rgba(40, 70, 120, 0.14)'
            : '0 26px 80px rgba(0, 0, 0, 0.28)',
      })}
    >
      <Stack spacing={2} sx={{ alignItems: 'center', minWidth: 0 }}>
        <Box sx={{ width: '100%', maxWidth: 440 }}>
          <ProxyTunCard disabled={disabled} />
        </Box>

        <LineSummaryChip currentLine={currentLine} />

        <SubscriptionStatusCard status={status} />
      </Stack>
    </Paper>
  )
}

const LineSummaryChip = ({
  currentLine,
}: {
  currentLine: { name: string; delayText: string }
}) => {
  const text = currentLine.delayText
    ? `当前线路：${currentLine.name} · ${currentLine.delayText}`
    : `当前线路：${currentLine.name}`

  return (
    <Box
      sx={(theme) => ({
        maxWidth: '100%',
        px: 1.6,
        py: 0.8,
        borderRadius: 999,
        boxSizing: 'border-box',
        color: theme.palette.text.primary,
        bgcolor:
          theme.palette.mode === 'light'
            ? alpha(PEWPEW_BLUE, 0.075)
            : alpha(PEWPEW_BLUE, 0.16),
        border: `1px solid ${alpha(PEWPEW_BLUE, 0.1)}`,
      })}
    >
      <Typography
        variant="body2"
        sx={{
          fontWeight: 800,
          textAlign: 'center',
          overflowWrap: 'anywhere',
        }}
      >
        {text}
      </Typography>
    </Box>
  )
}

const getExpireAlert = (value: string) => {
  const expireDate = dayjs(value)
  if (!expireDate.isValid()) return null

  const today = dayjs().startOf('day')
  const expireEnd = expireDate.endOf('day')

  if (expireEnd.isBefore(today)) {
    return { severity: 'error' as const, text: '套餐已到期，请续费后使用' }
  }

  if (expireDate.startOf('day').diff(today, 'day') <= 7) {
    return { severity: 'warning' as const, text: '套餐即将到期，请及时续费' }
  }

  return null
}

const SubscriptionStatusCard = ({
  status,
}: {
  status: PewPewSubscriptionStatus
}) => {
  const expireAlert = getExpireAlert(status.expire)
  const items = [
    {
      label: '剩余流量',
      value: status.remainingTraffic,
      icon: <TravelExploreRounded fontSize="small" />,
    },
    {
      label: '下次重置',
      value: status.nextReset,
      icon: <RestartAltRounded fontSize="small" />,
    },
    {
      label: '套餐到期',
      value: status.expire,
      icon: <EventAvailableRounded fontSize="small" />,
    },
  ]

  return (
    <Stack
      spacing={1.25}
      sx={{
        width: '100%',
        maxWidth: 760,
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{ fontWeight: 850, textAlign: 'center' }}
      >
        账户信息
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(3, minmax(0, 1fr))',
          },
          gap: 1,
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        {items.map((item) => (
          <Box
            key={item.label}
            sx={(theme) => ({
              minHeight: 82,
              minWidth: 0,
              borderRadius: 3,
              border: `1px solid ${alpha(PEWPEW_BLUE, 0.09)}`,
              px: 1.45,
              py: 1.2,
              boxSizing: 'border-box',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 0.65,
              bgcolor:
                theme.palette.mode === 'light'
                  ? alpha(PEWPEW_BLUE, 0.04)
                  : alpha(PEWPEW_BLUE, 0.12),
            })}
          >
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: 'center', minWidth: 0 }}
            >
              <Box sx={{ color: PEWPEW_BLUE, display: 'flex' }}>
                {item.icon}
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 750 }}
              >
                {item.label}
              </Typography>
            </Stack>
            <Typography
              sx={{
                fontSize: { xs: 17, sm: 18 },
                fontWeight: 900,
                lineHeight: 1.18,
                overflowWrap: 'anywhere',
              }}
            >
              {item.value}
            </Typography>
          </Box>
        ))}
      </Box>

      {expireAlert && (
        <Alert
          severity={expireAlert.severity}
          variant="outlined"
          sx={{ borderRadius: 3, py: 0.35, alignItems: 'center' }}
        >
          {expireAlert.text}
        </Alert>
      )}
    </Stack>
  )
}

const ConnectionSettingsCard = ({
  onDelayUpdated,
}: {
  onDelayUpdated: () => void
}) => {
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
            ? alpha(theme.palette.common.white, 0.84)
            : alpha(theme.palette.background.paper, 0.84),
        border: `1px solid ${alpha(PEWPEW_BLUE, 0.08)}`,
        boxShadow:
          theme.palette.mode === 'light'
            ? '0 14px 38px rgba(40, 70, 120, 0.07)'
            : '0 14px 38px rgba(0, 0, 0, 0.2)',
      })}
    >
      <Stack spacing={1.75}>
        <Typography variant="h6" sx={{ fontWeight: 850 }}>
          连接设置
        </Typography>

        <Grid container spacing={2.25}>
          <Grid size={{ xs: 12, md: 7 }}>
            <CurrentProxyCard embedded onDelayUpdated={onDelayUpdated} />
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <Stack spacing={1} sx={{ height: '100%' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>
                模式
              </Typography>
              <ClashModeCard />
            </Stack>
          </Grid>
        </Grid>
      </Stack>
    </Paper>
  )
}

const AboutDialog = ({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) => {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: { borderRadius: 4 },
        },
      }}
    >
      <DialogTitle sx={{ pr: 6, fontWeight: 850 }}>
        关于 / 开源许可
        <IconButton
          aria-label="关闭"
          onClick={onClose}
          sx={{ position: 'absolute', right: 12, top: 10 }}
        >
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              PewPew 云客户端
            </Typography>
            <Typography variant="body2" color="text.secondary">
              PewPew 云客户端基于 Clash Verge Rev、mihomo / Clash.Meta、Tauri
              构建。
            </Typography>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              开源许可
            </Typography>
            <Typography variant="body2" color="text.secondary">
              本客户端遵守 GPL-3.0 开源许可，并保留上游项目致谢。
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              上游致谢
            </Typography>
            <Stack spacing={0.5}>
              <Link
                href="https://github.com/clash-verge-rev/clash-verge-rev"
                target="_blank"
                rel="noreferrer"
                underline="hover"
              >
                Clash Verge Rev
              </Link>
              <Link
                href="https://github.com/MetaCubeX/mihomo"
                target="_blank"
                rel="noreferrer"
                underline="hover"
              >
                mihomo / Clash.Meta
              </Link>
              <Link
                href="https://tauri.app/"
                target="_blank"
                rel="noreferrer"
                underline="hover"
              >
                Tauri
              </Link>
            </Stack>
          </Box>

          <Typography variant="caption" color="text.secondary">
            客服微信：PewPew_VPN
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

export default HomePage
