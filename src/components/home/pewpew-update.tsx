import {
  CheckCircleRounded,
  ErrorOutlineRounded,
  SystemUpdateAltRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
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
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'
import { useLockFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

import {
  brandColor,
  dialogBackdropSx,
  dialogPaperSx,
  hairlineColor,
  pillButtonSx,
  reducedMotion,
} from '@/components/home/pewpew-ui'
import { usePewPewUpdate } from '@/hooks/use-pewpew-update'
import {
  getPortableFlag,
  prepareUpdateInstall,
  restartApp,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const statusIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

// Version line action in the About dialog.
export const UpdateStatus = ({
  onOpenUpdate,
}: {
  onOpenUpdate: () => void
}) => {
  const { t } = useTranslation()
  const { update, checked, checking, failed, check } = usePewPewUpdate()

  const status = checking ? (
    <>
      <CircularProgress size={14} thickness={5} />
      <span>{t('home.pewpew.update.checking')}</span>
    </>
  ) : update ? (
    <>
      <SystemUpdateAltRounded sx={{ fontSize: 17, color: 'primary.main' }} />
      <span>
        {t('home.pewpew.update.available', { version: update.version })}
      </span>
    </>
  ) : failed ? (
    <>
      <ErrorOutlineRounded sx={{ fontSize: 17, color: 'warning.main' }} />
      <span>{t('home.pewpew.update.failed')}</span>
    </>
  ) : checked ? (
    <>
      <CheckCircleRounded sx={{ fontSize: 17, color: 'success.main' }} />
      <span>{t('home.pewpew.update.latest')}</span>
    </>
  ) : null

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}
    >
      {status && (
        <Typography
          key={checking ? 'checking' : update ? 'update' : String(failed)}
          variant="body2"
          color="text.secondary"
          role="status"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            animation: `${statusIn} 240ms ease both`,
            [reducedMotion]: { animation: 'none' },
          }}
        >
          {status}
        </Typography>
      )}
      {update && !checking ? (
        <Button
          size="small"
          variant="contained"
          onClick={onOpenUpdate}
          sx={pillButtonSx}
        >
          {t('home.pewpew.update.view')}
        </Button>
      ) : (
        <Button
          size="small"
          disabled={checking}
          onClick={() => void check()}
          sx={pillButtonSx}
        >
          {t('home.pewpew.update.check')}
        </Button>
      )}
    </Stack>
  )
}

type InstallPhase =
  | 'ready'
  | 'downloading'
  | 'installing'
  | 'failed'
  | 'recovery'
type RecoveryMessage =
  | 'home.pewpew.update.cleanupFailed'
  | 'home.pewpew.update.installFailed'
  | 'home.pewpew.update.restartFailed'

export const UpdateDialog = ({
  open,
  update,
  onClose,
}: {
  open: boolean
  update: Update | null
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<InstallPhase>('ready')
  const [received, setReceived] = useState(0)
  const [total, setTotal] = useState(0)
  const [recoveryMessage, setRecoveryMessage] = useState<RecoveryMessage>(
    'home.pewpew.update.restartFailed',
  )
  const busy = phase === 'downloading' || phase === 'installing'
  const percent = total > 0 ? Math.min(100, (received / total) * 100) : 0

  const restartAfterCleanup = async (message?: RecoveryMessage) => {
    if (message) {
      setPhase('recovery')
      setRecoveryMessage(message)
      showNotice.error(t(message))
    }
    try {
      await restartApp()
    } catch (error) {
      console.error('[PewPew] 更新后重启失败:', error)
      setPhase('recovery')
      setRecoveryMessage('home.pewpew.update.restartFailed')
    }
  }

  const startUpdate = useLockFn(async () => {
    if (!update) return
    if (phase === 'recovery') {
      await restartAfterCleanup()
      return
    }
    if (await getPortableFlag().catch(() => false)) {
      showNotice.error(t('home.pewpew.update.portable'))
      return
    }
    setPhase('downloading')
    setReceived(0)
    setTotal(0)
    try {
      await update.download((event: DownloadEvent) => {
        if (event.event === 'Started') setTotal(event.data.contentLength ?? 0)
        else if (event.event === 'Progress')
          setReceived((value) => value + event.data.chunkLength)
      })
    } catch (error) {
      console.error('[PewPew] 下载更新失败:', error)
      setPhase('failed')
      return
    }

    setPhase('installing')
    // Restore the network first, the same way quitting does.
    try {
      await prepareUpdateInstall()
    } catch (error) {
      console.warn('[PewPew] 更新前清理未完成:', error)
      await restartAfterCleanup('home.pewpew.update.cleanupFailed')
      return
    }
    try {
      // The client exits here once the installer starts.
      await update.install()
    } catch (error) {
      console.error('[PewPew] 安装程序没有启动:', error)
      await restartAfterCleanup('home.pewpew.update.installFailed')
      return
    }
    // Windows exits inside install(); macOS and Linux return after replacing files.
    await restartAfterCleanup()
  })

  if (!update) return null

  const notes = update.body?.trim()

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      className="pewpew-dialog"
      slotProps={{
        paper: { sx: dialogPaperSx },
        backdrop: { sx: dialogBackdropSx },
      }}
    >
      <DialogTitle sx={{ fontWeight: 800, pb: 0.5 }}>
        {t('home.pewpew.update.title', { version: update.version })}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.75}>
          <Typography variant="body2" color="text.secondary">
            {t('home.pewpew.update.current', {
              version: update.currentVersion,
            })}
          </Typography>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.75 }}>
              {t('home.pewpew.update.notes')}
            </Typography>
            <Box
              sx={(theme) => ({
                maxHeight: 220,
                overflowY: 'auto',
                px: 1.5,
                py: 0.5,
                borderRadius: '14px',
                border: `1px solid ${hairlineColor(theme)}`,
                bgcolor: alpha(brandColor(theme), 0.04),
                fontSize: 14,
                lineHeight: 1.6,
                '& p': { my: 1 },
                '& ul, & ol': { my: 1, pl: 2.5 },
                '& a': { color: brandColor(theme) },
              })}
            >
              {notes ? (
                <ReactMarkdown>{notes}</ReactMarkdown>
              ) : (
                <p>{t('home.pewpew.update.noNotes')}</p>
              )}
            </Box>
          </Box>
          {busy ? (
            <Box role="status">
              <LinearProgress
                variant={
                  phase === 'downloading' && total > 0
                    ? 'determinate'
                    : 'indeterminate'
                }
                value={percent}
                sx={{ height: 6, borderRadius: 999 }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                component="p"
                sx={{ mt: 0.75 }}
              >
                {phase === 'installing'
                  ? t('home.pewpew.update.installing')
                  : total > 0
                    ? t('home.pewpew.update.downloading', {
                        percent: Math.round(percent),
                      })
                    : t('home.pewpew.update.downloadingUnknown')}
              </Typography>
            </Box>
          ) : phase === 'failed' || phase === 'recovery' ? (
            <Alert severity="error" sx={{ borderRadius: '12px' }}>
              {t(
                phase === 'recovery'
                  ? recoveryMessage
                  : 'home.pewpew.update.downloadFailed',
              )}
            </Alert>
          ) : (
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              sx={{ lineHeight: 1.5 }}
            >
              {t('home.pewpew.update.hint')}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button disabled={busy} onClick={onClose} sx={pillButtonSx}>
          {t('home.pewpew.update.later')}
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => void startUpdate()}
          startIcon={
            busy ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <SystemUpdateAltRounded />
            )
          }
          sx={pillButtonSx}
        >
          {t(
            phase === 'recovery'
              ? 'home.pewpew.update.restart'
              : phase === 'failed'
                ? 'home.pewpew.update.retry'
                : 'home.pewpew.update.install',
          )}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
