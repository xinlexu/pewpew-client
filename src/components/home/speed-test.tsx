import { ReplayRounded, SpeedRounded } from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
  alpha,
  keyframes,
} from '@mui/material'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getConnections } from 'tauri-plugin-mihomo-api'

import {
  brandColor,
  dialogBackdropSx,
  dialogPaperSx,
  hairlineColor,
  isLightTheme,
  pillButtonSx,
  reducedMotion,
  strongMutedColor,
} from '@/components/home/pewpew-ui'
import { cancelSpeedTest, runSpeedTest } from '@/services/cmds'

const TEST_HOST = 'speed.cloudflare.com'
const TEST_DURATION_MS = 8000
const GAUGE_MAX_MBPS = 1000

type Phase = 'running' | 'done' | 'failed'

// Square-root scale, so everyday speeds (50-300 Mbps) fill much of the dial.
const gaugeFraction = (mbps: number) =>
  Math.min(1, Math.sqrt(Math.max(0, mbps) / GAUGE_MAX_MBPS))

const formatMbps = (mbps: number) =>
  mbps >= 100 ? mbps.toFixed(0) : mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)

const formatData = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(2)} GB`
    : `${Math.max(1, Math.round(bytes / 1e6))} MB`

const resultIn = keyframes`
  0% { transform: scale(0.94); }
  60% { transform: scale(1.04); }
  100% { transform: none; }
`

// 240° speedometer arc from lower left, over the top, to lower right.
const SIZE = 236
const STROKE = 16
const RADIUS = (SIZE - STROKE) / 2
const CENTER = SIZE / 2
const point = (degrees: number) => {
  const radians = (degrees * Math.PI) / 180
  return `${CENTER + RADIUS * Math.cos(radians)} ${CENTER - RADIUS * Math.sin(radians)}`
}
const ARC = `M ${point(210)} A ${RADIUS} ${RADIUS} 0 1 1 ${point(-30)}`
const GAUGE_HEIGHT = CENTER + RADIUS * 0.5 + STROKE

const Gauge = ({ mbps, phase }: { mbps: number; phase: Phase }) => {
  const gradientId = useId()
  const { t } = useTranslation()
  const fraction = phase === 'failed' ? 0 : gaugeFraction(mbps)
  return (
    <Box sx={{ position: 'relative', width: SIZE, height: GAUGE_HEIGHT }}>
      <Box
        component="svg"
        viewBox={`0 0 ${SIZE} ${GAUGE_HEIGHT}`}
        aria-hidden
        sx={{ width: SIZE, height: GAUGE_HEIGHT, display: 'block' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#4f7cff" />
            <stop offset="55%" stopColor="#22b8f0" />
            <stop offset="100%" stopColor="#21c27a" />
          </linearGradient>
        </defs>
        <Box
          component="path"
          d={ARC}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          sx={(theme) => ({
            stroke: isLightTheme(theme)
              ? alpha('#0f1e46', 0.08)
              : alpha('#ffffff', 0.1),
          })}
        />
        <Box
          component="path"
          d={ARC}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={STROKE}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100 100"
          sx={{
            strokeDashoffset: 100 - fraction * 100,
            opacity: fraction > 0 ? 1 : 0,
            transition:
              'stroke-dashoffset 420ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 200ms ease',
            [reducedMotion]: { transition: 'none' },
          }}
        />
      </Box>
      <Stack
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: CENTER - 38,
          alignItems: 'center',
        }}
      >
        <Typography
          key={phase === 'done' ? 'done' : 'live'}
          component="p"
          role={phase === 'done' ? 'status' : undefined}
          sx={{
            fontSize: 46,
            lineHeight: 1,
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: 0,
            animation:
              phase === 'done'
                ? `${resultIn} 420ms cubic-bezier(0.2, 0.8, 0.2, 1)`
                : 'none',
            [reducedMotion]: { animation: 'none' },
          }}
        >
          {phase === 'failed' ? '--' : formatMbps(mbps)}
        </Typography>
        <Typography
          variant="body2"
          sx={(theme) => ({
            mt: 0.5,
            fontWeight: 700,
            color: strongMutedColor(theme),
          })}
        >
          Mbps · {t('home.pewpew.speedTest.download')}
        </Typography>
      </Stack>
    </Box>
  )
}

export const SpeedTestDialog = ({
  open,
  routeName,
  delayText,
  onClose,
}: {
  open: boolean
  routeName?: string
  delayText?: string
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('running')
  const [mbps, setMbps] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [received, setReceived] = useState(0)
  const [direct, setDirect] = useState(false)
  // Each test gets a number; results from a closed or replaced test are ignored.
  const runRef = useRef(0)
  const pendingRef = useRef<ReturnType<typeof runSpeedTest> | null>(null)
  const cancelRef = useRef<Promise<unknown> | null>(null)

  const start = useCallback(async () => {
    runRef.current += 1
    const run = runRef.current
    setPhase('running')
    setMbps(0)
    setElapsed(0)
    setReceived(0)
    setDirect(false)

    // Cancellation is asynchronous; wait for the old command and its cancel acknowledgement.
    await Promise.all([pendingRef.current?.catch(() => {}), cancelRef.current])
    if (run !== runRef.current) return

    // Rules may send the test server direct; then it measures the local line.
    const routeCheck = window.setTimeout(async () => {
      const connections = await getConnections()
        .then((data) => data.connections ?? [])
        .catch(() => [])
      const test = connections.filter((c) => c.metadata?.host === TEST_HOST)
      if (
        run === runRef.current &&
        test.length > 0 &&
        test.every((c) => c.chains?.includes('DIRECT'))
      )
        setDirect(true)
    }, 1500)

    let smoothed = 0
    let pending: ReturnType<typeof runSpeedTest> | null = null
    try {
      pending = runSpeedTest((progress) => {
        if (run !== runRef.current) return
        smoothed = smoothed
          ? smoothed * 0.6 + progress.mbps * 0.4
          : progress.mbps
        setMbps(smoothed)
        setElapsed(progress.elapsedMs)
        setReceived(progress.bytes)
      })
      pendingRef.current = pending
      const result = await pending
      if (run !== runRef.current) return
      setMbps(result.mbps)
      setReceived(result.bytes)
      setElapsed(TEST_DURATION_MS)
      setPhase('done')
    } catch (error) {
      if (run !== runRef.current) return
      console.warn('[PewPew] 测速失败:', error)
      setPhase('failed')
    } finally {
      if (pendingRef.current === pending) pendingRef.current = null
      window.clearTimeout(routeCheck)
    }
  }, [])

  useEffect(() => {
    let active = true
    if (open)
      queueMicrotask(() => {
        if (active) void start()
      })
    return () => {
      active = false
      runRef.current += 1
      if (pendingRef.current)
        cancelRef.current = cancelSpeedTest().catch(() => {})
    }
  }, [open, start])

  const close = () => {
    onClose()
  }

  const running = phase === 'running'

  return (
    <Dialog
      open={open}
      onClose={close}
      maxWidth="xs"
      fullWidth
      className="pewpew-dialog"
      slotProps={{
        paper: { sx: dialogPaperSx },
        backdrop: { sx: dialogBackdropSx },
      }}
    >
      <DialogTitle sx={{ fontWeight: 800, pb: 0.5 }}>
        {t('home.pewpew.speedTest.title')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
          {routeName && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ alignSelf: 'stretch', overflowWrap: 'anywhere' }}
            >
              {routeName}
            </Typography>
          )}
          <Gauge mbps={mbps} phase={phase} />
          {running ? (
            <Box sx={{ alignSelf: 'stretch' }}>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, (elapsed / TEST_DURATION_MS) * 100)}
                aria-label={t('home.pewpew.speedTest.testing')}
                sx={{ height: 4, borderRadius: 999 }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                component="p"
                sx={{ mt: 0.75, textAlign: 'center' }}
              >
                {t(
                  received > 0
                    ? 'home.pewpew.speedTest.testing'
                    : 'home.pewpew.speedTest.connecting',
                )}
              </Typography>
            </Box>
          ) : phase === 'done' ? (
            <Stack
              direction="row"
              spacing={1}
              sx={(theme) => ({
                alignSelf: 'stretch',
                justifyContent: 'center',
                flexWrap: 'wrap',
                rowGap: 0.75,
                '& > *': {
                  px: 1.25,
                  py: 0.5,
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 700,
                  border: `1px solid ${hairlineColor(theme)}`,
                  bgcolor: alpha(brandColor(theme), 0.06),
                },
              })}
            >
              {delayText && (
                <span>
                  {t('home.pewpew.speedTest.latency', { delay: delayText })}
                </span>
              )}
              <span>
                {t('home.pewpew.speedTest.dataUsed', {
                  size: formatData(received),
                })}
              </span>
            </Stack>
          ) : (
            <Alert
              severity="error"
              sx={{ alignSelf: 'stretch', borderRadius: '12px' }}
            >
              {t('home.pewpew.speedTest.failed')}
            </Alert>
          )}
          {direct && (
            <Alert
              severity="warning"
              sx={{ alignSelf: 'stretch', borderRadius: '12px' }}
            >
              {t('home.pewpew.speedTest.direct')}
            </Alert>
          )}
          <Typography
            variant="caption"
            color="text.secondary"
            component="p"
            sx={{ alignSelf: 'stretch', lineHeight: 1.5 }}
          >
            {t('home.pewpew.speedTest.hint')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={close} sx={pillButtonSx}>
          {t(
            running ? 'home.pewpew.speedTest.stop' : 'home.pewpew.about.close',
          )}
        </Button>
        <Button
          variant="contained"
          disabled={running}
          onClick={() => void start()}
          startIcon={running ? <SpeedRounded /> : <ReplayRounded />}
          sx={pillButtonSx}
        >
          {t('home.pewpew.speedTest.again')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
