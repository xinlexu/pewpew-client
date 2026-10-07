import {
  BuildRounded,
  CloseRounded,
  ContentCopyRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
} from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { useQuery } from '@tanstack/react-query'
import { getVersion } from '@tauri-apps/api/app'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import pewpewLogo from '@/assets/pewpew-logo.jpg'
import {
  PEWPEW_WECHAT_ID,
  brandColor,
  copyToClipboard,
  dialogBackdropSx,
  dialogPaperSx,
  pillButtonSx,
  segmentedControlSx,
} from '@/components/home/pewpew-ui'
import { useI18n } from '@/hooks/use-i18n'
import { useVerge } from '@/hooks/use-verge'
import type { ClientLanguageMode } from '@/services/i18n'
import { getCachedClientLanguageMode } from '@/services/i18n'
import { showNotice } from '@/services/notice-service'

type PreferencePatch = Pick<
  IVergeConfig,
  | 'theme_mode'
  | 'enable_auto_launch'
  | 'enable_silent_start'
  | 'auto_close_connection'
>

const DialogHeader = ({
  title,
  closeLabel,
  onClose,
}: {
  title: string
  closeLabel: string
  onClose: () => void
}) => (
  <DialogTitle sx={{ pr: 7, fontWeight: 800 }}>
    {title}
    <IconButton
      aria-label={closeLabel}
      onClick={onClose}
      sx={{ position: 'absolute', right: 14, top: 12 }}
    >
      <CloseRounded />
    </IconButton>
  </DialogTitle>
)

export const PreferencesDialog = ({
  autoUpdateRoutesOnStartup,
  open,
  onClose,
  onAutoUpdateRoutesOnStartupChange,
  onCopyDiagnostics,
  onRepairNetwork,
  repairingNetwork,
}: {
  autoUpdateRoutesOnStartup: boolean
  open: boolean
  onClose: () => void
  onAutoUpdateRoutesOnStartupChange: (enabled: boolean) => void
  onCopyDiagnostics: () => Promise<void>
  onRepairNetwork: () => Promise<void>
  repairingNetwork: boolean
}) => {
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const { switchClientLanguageMode, isLoading: languageLoading } = useI18n()
  const [languageMode, setLanguageMode] = useState<ClientLanguageMode>(
    () => getCachedClientLanguageMode() ?? 'system',
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      queueMicrotask(() =>
        setLanguageMode(getCachedClientLanguageMode() ?? 'system'),
      )
    }
  }, [open])

  const updatePreference = async (patch: Partial<PreferencePatch>) => {
    setSaving(true)
    mutateVerge((prev) => (prev ? { ...prev, ...patch } : prev), false)

    try {
      await patchVerge(patch)
    } catch (error) {
      console.error('[PewPew] 偏好设置保存失败:', error)
      showNotice.error(t('home.pewpew.preferences.saveFailed'))
      mutateVerge()
    } finally {
      setSaving(false)
    }
  }

  const handleThemeModeChange = (_event: unknown, value: string | null) => {
    if (!value) return
    void updatePreference({
      theme_mode: value as NonNullable<IVergeConfig['theme_mode']>,
    })
  }

  const handleLanguageModeChange = async (
    _event: unknown,
    value: ClientLanguageMode | null,
  ) => {
    if (!value) return
    const previous = languageMode
    setLanguageMode(value)

    try {
      await switchClientLanguageMode(value)
    } catch {
      setLanguageMode(previous)
      showNotice.error(t('home.pewpew.preferences.saveFailed'))
    }
  }

  const preferenceDisabled = saving || languageLoading
  const themeMode = verge?.theme_mode ?? 'system'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      className="pewpew-dialog"
      slotProps={{
        paper: { sx: dialogPaperSx },
        backdrop: { sx: dialogBackdropSx },
      }}
    >
      <DialogHeader
        title={t('home.pewpew.preferences.title')}
        closeLabel={t('home.pewpew.about.close')}
        onClose={onClose}
      />
      <DialogContent dividers sx={{ px: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.25}>
          <PreferenceSection title={t('home.pewpew.preferences.appearance')}>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              value={themeMode}
              onChange={handleThemeModeChange}
              disabled={preferenceDisabled}
              aria-label={t('home.pewpew.preferences.appearance')}
              sx={segmentedControlSx}
            >
              <ToggleButton value="system">
                {t('home.pewpew.preferences.followSystem')}
              </ToggleButton>
              <ToggleButton value="light">
                {t('home.pewpew.preferences.light')}
              </ToggleButton>
              <ToggleButton value="dark">
                {t('home.pewpew.preferences.dark')}
              </ToggleButton>
            </ToggleButtonGroup>
          </PreferenceSection>

          <PreferenceSection title={t('home.pewpew.preferences.language')}>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              value={languageMode}
              onChange={handleLanguageModeChange}
              disabled={preferenceDisabled}
              aria-label={t('home.pewpew.preferences.language')}
              sx={segmentedControlSx}
            >
              <ToggleButton value="system">
                {t('home.pewpew.preferences.followSystem')}
              </ToggleButton>
              <ToggleButton value="zh-CN" lang="zh-CN">
                简体中文
              </ToggleButton>
              <ToggleButton value="en-US" lang="en">
                English
              </ToggleButton>
            </ToggleButtonGroup>
          </PreferenceSection>

          <PreferenceSection title={t('home.pewpew.preferences.startup')}>
            <Stack spacing={0.25}>
              <PreferenceSwitch
                label={t('home.pewpew.preferences.autoLaunch')}
                checked={verge?.enable_auto_launch ?? false}
                disabled={preferenceDisabled}
                onChange={(checked) =>
                  void updatePreference({ enable_auto_launch: checked })
                }
              />
              <PreferenceSwitch
                label={t('home.pewpew.preferences.silentStart')}
                checked={verge?.enable_silent_start ?? false}
                disabled={preferenceDisabled}
                onChange={(checked) =>
                  void updatePreference({ enable_silent_start: checked })
                }
              />
              <PreferenceSwitch
                label={t('home.pewpew.preferences.autoUpdateRoutesOnStartup')}
                checked={autoUpdateRoutesOnStartup}
                disabled={preferenceDisabled}
                onChange={onAutoUpdateRoutesOnStartupChange}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                component="p"
                sx={{ pt: 0.5, lineHeight: 1.5 }}
              >
                {t('home.pewpew.preferences.restoreHint')}
              </Typography>
            </Stack>
          </PreferenceSection>

          <PreferenceSection title={t('home.pewpew.preferences.connection')}>
            <PreferenceSwitch
              label={t('home.pewpew.preferences.autoCloseConnections')}
              description={t(
                'home.pewpew.preferences.autoCloseConnectionsHint',
              )}
              checked={verge?.auto_close_connection ?? true}
              disabled={preferenceDisabled}
              onChange={(checked) =>
                void updatePreference({ auto_close_connection: checked })
              }
            />
          </PreferenceSection>
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{ px: { xs: 2, sm: 3 }, py: 2, gap: 1, flexWrap: 'wrap' }}
      >
        <Button
          variant="outlined"
          onClick={() => void onRepairNetwork().catch(() => {})}
          disabled={preferenceDisabled || repairingNetwork}
          startIcon={<BuildRounded />}
          sx={pillButtonSx}
        >
          {t('home.pewpew.connectionStatus.repairNetwork')}
        </Button>
        <Button
          variant="text"
          onClick={() => void onCopyDiagnostics()}
          startIcon={<ContentCopyRounded />}
          sx={{ ...pillButtonSx, mr: 'auto', ml: '0 !important' }}
        >
          {t('home.pewpew.diagnostics.copy')}
        </Button>
        <Button
          variant="contained"
          onClick={onClose}
          sx={{ ...pillButtonSx, ml: '0 !important' }}
        >
          {t('home.pewpew.about.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const PreferenceSection = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) => {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
        {title}
      </Typography>
      {children}
    </Stack>
  )
}

const PreferenceSwitch = ({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) => {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 2,
        alignItems: 'center',
        minHeight: 42,
        minWidth: 0,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
        >
          {label}
        </Typography>
        {description && (
          <Typography
            variant="caption"
            color="text.secondary"
            component="p"
            sx={{ lineHeight: 1.45 }}
          >
            {description}
          </Typography>
        )}
      </Box>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        slotProps={{ input: { 'aria-label': label } }}
        sx={pewpewSwitchSx}
      />
    </Box>
  )
}

const pewpewSwitchSx = (theme: Theme) => ({
  width: 48,
  height: 30,
  p: 0.75,
  flexShrink: 0,
  '& .MuiSwitch-switchBase': {
    p: 0.75,
    transitionDuration: '220ms',
    '&.Mui-checked': {
      transform: 'translateX(18px)',
      color: '#fff',
      '& + .MuiSwitch-track': {
        bgcolor: brandColor(theme),
        opacity: 1,
      },
    },
    '&.Mui-disabled': {
      color: theme.palette.mode === 'light' ? '#f1f5f9' : '#6b7280',
      '& + .MuiSwitch-track': {
        opacity: 1,
        bgcolor:
          theme.palette.mode === 'light' ? '#e5e7eb' : 'rgba(255,255,255,0.12)',
      },
    },
  },
  '& .MuiSwitch-thumb': {
    width: 18,
    height: 18,
    bgcolor: '#fff',
    boxShadow: '0 1px 4px rgba(15,23,42,0.28) !important',
  },
  '& .MuiSwitch-track': {
    borderRadius: 999,
    opacity: 1,
    bgcolor:
      theme.palette.mode === 'light' ? '#cbd5e1' : 'rgba(255,255,255,0.22)',
  },
})

export const AboutDialog = ({
  open,
  onClose,
  onCopyDiagnostics,
}: {
  open: boolean
  onClose: () => void
  onCopyDiagnostics: () => Promise<void>
}) => {
  const { t } = useTranslation()
  const { data: version } = useQuery({
    queryKey: ['pewpewAppVersion'],
    queryFn: () => getVersion(),
    staleTime: Infinity,
    enabled: open,
  })

  const copyWechat = async () => {
    try {
      await copyToClipboard(PEWPEW_WECHAT_ID)
      showNotice.success(t('home.pewpew.header.wechatCopied'))
    } catch {
      showNotice.error(t('home.pewpew.diagnostics.copyFailed'))
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      className="pewpew-dialog"
      slotProps={{
        paper: { sx: dialogPaperSx },
        backdrop: { sx: dialogBackdropSx },
      }}
    >
      <DialogHeader
        title={t('home.pewpew.about.title')}
        closeLabel={t('home.pewpew.about.close')}
        onClose={onClose}
      />
      <DialogContent dividers sx={{ px: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.25}>
          <Stack direction="row" spacing={1.75} sx={{ alignItems: 'center' }}>
            <Box
              component="img"
              src={pewpewLogo}
              alt=""
              sx={{
                width: 56,
                height: 56,
                borderRadius: '16px',
                objectFit: 'cover',
                flexShrink: 0,
              }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                {t('home.pewpew.about.clientName')}
              </Typography>
              {version && (
                <Typography variant="body2" color="text.secondary">
                  {t('home.pewpew.about.version', { version })}
                </Typography>
              )}
            </Box>
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {t('home.pewpew.about.description')}
          </Typography>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
              {t('home.pewpew.about.licenseTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('home.pewpew.about.license')}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
              {t('home.pewpew.about.credits')}
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

          <Stack
            direction="row"
            spacing={1}
            sx={(theme) => ({
              alignItems: 'center',
              justifyContent: 'space-between',
              borderRadius: '14px',
              px: 1.5,
              py: 1,
              bgcolor: alpha(brandColor(theme), 0.06),
            })}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t('home.pewpew.about.support')}
            </Typography>
            <Button
              size="small"
              startIcon={<ContentCopyRounded />}
              onClick={() => void copyWechat()}
              sx={pillButtonSx}
            >
              {t('home.pewpew.header.copyWechat')}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          onClick={() => void onCopyDiagnostics()}
          startIcon={<ContentCopyRounded />}
          sx={{ ...pillButtonSx, mr: 'auto' }}
        >
          {t('home.pewpew.diagnostics.copy')}
        </Button>
        <Button variant="contained" onClick={onClose} sx={pillButtonSx}>
          {t('home.pewpew.about.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
