import { alpha, keyframes, type Theme } from '@mui/material'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'

// PewPew "clear glass" design tokens shared by the home page, cards and dialogs.
export const PEWPEW_BLUE = '#2457d6'
export const PEWPEW_BLUE_BRIGHT = '#8db4ff'
export const WECHAT_GREEN = '#07c160'
export const PEWPEW_WECHAT_ID = 'PewPew_VPN'

// Navy tint for light-mode hairlines and control tracks.
const NAVY = '#0f1e46'
const GLASS_BLUR = 'blur(22px) saturate(160%)'

export const reducedMotion = '@media (prefers-reduced-motion: reduce)'

const noBackdropBlur =
  '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))'

export const isLightTheme = (theme: Theme) => theme.palette.mode === 'light'

export const brandColor = (theme: Theme) =>
  isLightTheme(theme) ? PEWPEW_BLUE : PEWPEW_BLUE_BRIGHT

// Secondary copy that sits close to a headline (status detail, values).
export const strongMutedColor = (theme: Theme) =>
  isLightTheme(theme) ? '#46536d' : '#b6c0d8'

export const hairlineColor = (theme: Theme) =>
  isLightTheme(theme) ? alpha(NAVY, 0.08) : alpha('#ffffff', 0.08)

// Soft entrance for the main surfaces.
const riseIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
`

// Frosted glass card. The global theme resets `box-shadow` and `outline` with
// `!important`, so PewPew surfaces opt back in explicitly.
export const surfaceSx =
  (variant: 'primary' | 'secondary' = 'secondary') =>
  (theme: Theme) => {
    const light = isLightTheme(theme)
    return {
      position: 'relative' as const,
      boxSizing: 'border-box' as const,
      borderRadius: variant === 'primary' ? '24px' : '20px',
      bgcolor: light ? alpha('#ffffff', 0.58) : alpha('#161e34', 0.56),
      border: `1px solid ${light ? alpha('#ffffff', 0.75) : alpha('#ffffff', 0.1)}`,
      WebkitBackdropFilter: GLASS_BLUR,
      backdropFilter: GLASS_BLUR,
      boxShadow: light
        ? variant === 'primary'
          ? '0 20px 50px rgba(40, 70, 140, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.9) !important'
          : '0 14px 36px rgba(40, 70, 140, 0.11), inset 0 1px 0 rgba(255, 255, 255, 0.9) !important'
        : variant === 'primary'
          ? '0 20px 50px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06) !important'
          : '0 14px 36px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.06) !important',
      animation: `${riseIn} 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both`,
      [reducedMotion]: { animation: 'none' },
      // Without backdrop blur the glass needs more opacity to stay readable.
      [noBackdropBlur]: {
        bgcolor: light ? alpha('#ffffff', 0.88) : alpha('#161e34', 0.94),
      },
    }
  }

// Lighter glass panel nested inside a card (account summary).
export const insetPanelSx = (theme: Theme) => {
  const light = isLightTheme(theme)
  return {
    borderRadius: '16px',
    bgcolor: light ? alpha('#ffffff', 0.55) : alpha('#ffffff', 0.04),
    border: `1px solid ${light ? alpha('#ffffff', 0.85) : alpha('#ffffff', 0.08)}`,
  }
}

// Outlined input root (route select, subscription link) on glass.
export const glassFieldSx = (theme: Theme) => {
  const light = isLightTheme(theme)
  const brand = brandColor(theme)
  return {
    borderRadius: '14px',
    bgcolor: light ? alpha('#ffffff', 0.72) : alpha('#ffffff', 0.05),
    transition: 'background-color 160ms ease',
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: light ? alpha(NAVY, 0.1) : alpha('#ffffff', 0.12),
      transition: 'border-color 160ms ease',
    },
    '&:hover:not(.Mui-disabled)': {
      bgcolor: light ? alpha('#ffffff', 0.86) : alpha('#ffffff', 0.07),
    },
    '&:hover:not(.Mui-disabled):not(.Mui-focused) .MuiOutlinedInput-notchedOutline':
      { borderColor: alpha(brand, 0.45) },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: brand,
      borderWidth: '1.5px',
    },
    [reducedMotion]: { transition: 'none' },
  }
}

// Frosted popover paper for menus such as the route list.
export const glassMenuPaperSx = (theme: Theme) => {
  const light = isLightTheme(theme)
  return {
    mt: 0.75,
    borderRadius: '16px',
    backgroundImage: 'none',
    bgcolor: light ? alpha('#ffffff', 0.84) : alpha('#161e34', 0.9),
    WebkitBackdropFilter: 'blur(24px) saturate(160%)',
    backdropFilter: 'blur(24px) saturate(160%)',
    border: '1px solid',
    // The global theme forces paper border colors with !important.
    '&.MuiPaper-root': {
      borderColor: `${light ? alpha('#ffffff', 0.9) : alpha('#ffffff', 0.1)} !important`,
    },
    boxShadow: light
      ? '0 18px 44px rgba(40, 70, 140, 0.18) !important'
      : '0 18px 44px rgba(0, 0, 0, 0.5) !important',
    '& .MuiMenuItem-root': {
      mx: 0.75,
      borderRadius: '10px',
    },
    '& .MuiMenuItem-root.Mui-selected': {
      bgcolor: alpha(brandColor(theme), light ? 0.1 : 0.16),
    },
  }
}

export const sectionLabelSx = {
  fontSize: 13,
  fontWeight: 700,
  color: 'text.secondary',
  letterSpacing: 0,
} as const

// Segmented control used for connection method, routing mode and preferences.
export const segmentedControlSx = (theme: Theme) => {
  const light = isLightTheme(theme)
  const brand = brandColor(theme)
  return {
    p: 0.5,
    gap: 0.5,
    borderRadius: '14px',
    bgcolor: light ? alpha(NAVY, 0.06) : alpha('#ffffff', 0.06),
    border: `1px solid ${light ? alpha('#ffffff', 0.6) : alpha('#ffffff', 0.08)}`,
    '& .MuiToggleButtonGroup-grouped': {
      m: 0,
      border: 0,
      borderRadius: '10px !important',
    },
    '& .MuiToggleButton-root': {
      minHeight: 36,
      px: 1.25,
      py: 0.6,
      flex: 1,
      textTransform: 'none',
      fontWeight: 700,
      fontSize: 14,
      lineHeight: 1.25,
      whiteSpace: 'normal',
      // A touch darker than text.secondary so it stays AA on the tinted track.
      color: light ? '#4f5a6d' : theme.palette.text.secondary,
      transition:
        'background-color 200ms ease, color 200ms ease, box-shadow 200ms ease',
      '&:hover': {
        bgcolor: light ? alpha('#ffffff', 0.5) : alpha('#ffffff', 0.06),
      },
      '&.Mui-selected, &.Mui-selected:hover': {
        color: light ? brand : '#dbe6ff',
        bgcolor: light ? alpha('#ffffff', 0.94) : alpha('#ffffff', 0.14),
        boxShadow: light
          ? '0 2px 10px rgba(30, 60, 120, 0.12) !important'
          : 'inset 0 1px 0 rgba(255, 255, 255, 0.08) !important',
      },
      '&.Mui-disabled': {
        color: theme.palette.text.disabled,
        border: 0,
      },
      '&.Mui-selected.Mui-disabled': {
        color: alpha(light ? brand : '#dbe6ff', 0.55),
      },
      '&.Mui-focusVisible': {
        outline: `2px solid ${alpha(brand, 0.7)} !important`,
        outlineOffset: '-2px',
      },
      [reducedMotion]: { transition: 'none' },
    },
  }
}

export const dialogPaperSx = (theme: Theme) => {
  const light = isLightTheme(theme)
  return {
    borderRadius: '22px',
    backgroundImage: 'none',
    border: '1px solid',
    WebkitBackdropFilter: 'blur(28px) saturate(160%)',
    backdropFilter: 'blur(28px) saturate(160%)',
    // The global theme forces dialog backgrounds and paper borders.
    '&.MuiDialog-paper': {
      backgroundColor: `${light ? alpha('#ffffff', 0.92) : alpha('#151c30', 0.94)} !important`,
    },
    '&.MuiPaper-root': {
      borderColor: `${light ? alpha('#ffffff', 0.9) : alpha('#ffffff', 0.1)} !important`,
    },
    boxShadow: light
      ? '0 28px 70px rgba(25, 45, 100, 0.28) !important'
      : '0 28px 70px rgba(0, 0, 0, 0.6) !important',
  }
}

export const dialogBackdropSx = (theme: Theme) => ({
  bgcolor: isLightTheme(theme)
    ? 'rgba(15, 23, 42, 0.26)'
    : 'rgba(2, 6, 18, 0.58)',
  WebkitBackdropFilter: 'blur(6px)',
  backdropFilter: 'blur(6px)',
})

export const pillButtonSx = {
  borderRadius: 999,
  fontWeight: 700,
  textTransform: 'none',
} as const

// Outlined pill that keeps a light glass fill on translucent cards.
export const glassOutlinedButtonSx = (theme: Theme) => ({
  ...pillButtonSx,
  bgcolor: isLightTheme(theme)
    ? alpha('#ffffff', 0.55)
    : alpha('#ffffff', 0.04),
  borderColor: alpha(brandColor(theme), 0.4),
  '&:hover': {
    bgcolor: alpha(brandColor(theme), isLightTheme(theme) ? 0.08 : 0.12),
    borderColor: brandColor(theme),
  },
})

// Small rounded tile behind an icon (subscription card, account metrics).
export const iconTileSx = (theme: Theme, size = 38) => ({
  width: size,
  height: size,
  borderRadius: size >= 30 ? '12px' : '6px',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: brandColor(theme),
  bgcolor: alpha(brandColor(theme), isLightTheme(theme) ? 0.1 : 0.14),
})

export const copyToClipboard = async (text: string) => {
  try {
    await writeText(text)
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

// Text colors for warning/error copy that keep WCAG AA contrast on cards.
export const toneTextColor = (theme: Theme, tone: 'warning' | 'error') =>
  isLightTheme(theme)
    ? tone === 'warning'
      ? '#b45309'
      : '#c53030'
    : tone === 'warning'
      ? '#fbbf24'
      : '#ff8a80'
