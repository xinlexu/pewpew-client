import { PowerSettingsNewRounded } from '@mui/icons-material'
import {
  Box,
  ButtonBase,
  CircularProgress,
  alpha,
  keyframes,
  type Theme,
} from '@mui/material'
import type { ReactNode } from 'react'

import {
  brandColor,
  isLightTheme,
  reducedMotion,
} from '@/components/home/pewpew-ui'

export type PowerButtonTone =
  | 'idle'
  | 'busy'
  | 'connected'
  | 'warning'
  | 'failed'
  | 'unavailable'

interface PowerButtonProps {
  tone: PowerButtonTone
  label: ReactNode
  disabled?: boolean
  // Shows a spinner instead of the power icon (connecting, loading routes…).
  spinning?: boolean
  // Smaller button when connecting is not the next step (e.g. plan expired).
  compact?: boolean
  onClick?: () => void
}

type ToneStyle = {
  color: string
  ring: [string, string, string]
  glow: string
  // Drop shadow at rest and while hovered.
  drop: string
  hoverDrop: string
}

const spin = keyframes`
  to { transform: rotate(360deg); }
`

const breathe = keyframes`
  0%, 100% { opacity: 0.35; transform: scale(0.97); }
  50% { opacity: 1; transform: scale(1.05); }
`

const LIGHT_HIGHLIGHT = 'inset 0 1px 0 #ffffff'
const DARK_HIGHLIGHT = 'inset 0 1px 0 rgba(255, 255, 255, 0.14)'

const toneStyle = (theme: Theme, tone: PowerButtonTone): ToneStyle => {
  if (isLightTheme(theme)) {
    switch (tone) {
      case 'connected':
        return {
          // Deep enough for AA on the white face (16px label).
          color: '#0b7a50',
          ring: ['#34d399', '#0f8a5c', '#22d3ee'],
          glow: 'rgba(16, 185, 129, 0.45)',
          drop: '0 16px 38px rgba(16, 160, 110, 0.24)',
          hoverDrop: '0 20px 44px rgba(16, 160, 110, 0.32)',
        }
      case 'warning':
        return {
          color: '#a64b0a',
          ring: ['#fcd34d', '#d97706', '#fbbf24'],
          glow: 'rgba(217, 119, 6, 0.4)',
          drop: '0 16px 38px rgba(217, 119, 6, 0.2)',
          hoverDrop: '0 20px 44px rgba(217, 119, 6, 0.28)',
        }
      case 'failed':
        return {
          color: '#c53030',
          ring: ['#fda4af', '#e5484d', '#fb923c'],
          glow: 'rgba(229, 72, 77, 0.4)',
          drop: '0 16px 38px rgba(229, 72, 77, 0.2)',
          hoverDrop: '0 20px 44px rgba(229, 72, 77, 0.28)',
        }
      case 'unavailable':
        return {
          color: '#8792a6',
          ring: ['#dbe2ec', '#b9c3d3', '#dbe2ec'],
          glow: 'transparent',
          drop: '0 10px 26px rgba(40, 70, 140, 0.1)',
          hoverDrop: '0 10px 26px rgba(40, 70, 140, 0.1)',
        }
      default:
        return {
          color: brandColor(theme),
          ring: ['#38bdf8', brandColor(theme), '#6366f1'],
          glow: 'rgba(56, 130, 246, 0.45)',
          drop: '0 16px 38px rgba(36, 87, 214, 0.22)',
          hoverDrop: '0 20px 44px rgba(36, 87, 214, 0.3)',
        }
    }
  }

  switch (tone) {
    case 'connected':
      return {
        color: '#4ade80',
        ring: ['#34d399', '#10b981', '#22d3ee'],
        glow: 'rgba(52, 211, 153, 0.4)',
        drop: '0 16px 40px rgba(0, 0, 0, 0.45), 0 0 34px rgba(52, 211, 153, 0.16)',
        hoverDrop:
          '0 20px 46px rgba(0, 0, 0, 0.5), 0 0 40px rgba(52, 211, 153, 0.24)',
      }
    case 'warning':
      return {
        color: '#fbbf24',
        ring: ['#fde68a', '#f59e0b', '#fbbf24'],
        glow: 'rgba(251, 191, 36, 0.35)',
        drop: '0 16px 40px rgba(0, 0, 0, 0.45)',
        hoverDrop:
          '0 20px 46px rgba(0, 0, 0, 0.5), 0 0 36px rgba(251, 191, 36, 0.16)',
      }
    case 'failed':
      return {
        color: '#ff8a80',
        ring: ['#fda4af', '#ef4444', '#fb923c'],
        glow: 'rgba(239, 68, 68, 0.35)',
        drop: '0 16px 40px rgba(0, 0, 0, 0.45)',
        hoverDrop:
          '0 20px 46px rgba(0, 0, 0, 0.5), 0 0 36px rgba(239, 68, 68, 0.16)',
      }
    case 'unavailable':
      return {
        color: 'rgba(255, 255, 255, 0.4)',
        ring: [
          'rgba(255, 255, 255, 0.16)',
          'rgba(255, 255, 255, 0.24)',
          'rgba(255, 255, 255, 0.16)',
        ],
        glow: 'transparent',
        drop: '0 12px 30px rgba(0, 0, 0, 0.35)',
        hoverDrop: '0 12px 30px rgba(0, 0, 0, 0.35)',
      }
    default:
      return {
        color: brandColor(theme),
        ring: ['#38bdf8', '#5b8def', '#818cf8'],
        glow: 'rgba(91, 141, 239, 0.45)',
        drop: '0 16px 40px rgba(0, 0, 0, 0.45)',
        hoverDrop:
          '0 20px 46px rgba(0, 0, 0, 0.5), 0 0 36px rgba(91, 141, 239, 0.2)',
      }
  }
}

const RING_MASK =
  'radial-gradient(farthest-side, transparent calc(100% - 4.5px), #000 calc(100% - 4px))'

// Round glass connect button with a gradient ring. The ring and glow are
// siblings of the <button> so they never count as overflow of the button,
// and the ring colors are registered custom properties (see index.scss) so
// state changes fade instead of snapping.
export const PowerButton = ({
  tone,
  label,
  disabled = false,
  spinning = false,
  compact = false,
  onClick,
}: PowerButtonProps) => {
  const busy = tone === 'busy'
  const size = compact ? { xs: 112, sm: 116 } : { xs: 136, sm: 156 }

  return (
    <Box
      className="pewpew-power-wrap"
      sx={(theme) => {
        const style = toneStyle(theme, tone)
        return {
          '--pp-ring-a': style.ring[0],
          '--pp-ring-b': style.ring[1],
          '--pp-ring-c': style.ring[2],
          position: 'relative',
          isolation: 'isolate',
          flexShrink: 0,
          width: size,
          height: size,
          m: '10px',
          transition:
            '--pp-ring-a 450ms ease, --pp-ring-b 450ms ease, --pp-ring-c 450ms ease',
          '& .pp-glow': {
            position: 'absolute',
            // Explicit offsets instead of `inset` for older macOS WebKit.
            top: -24,
            right: -24,
            bottom: -24,
            left: -24,
            zIndex: 0,
            borderRadius: '50%',
            pointerEvents: 'none',
            background: `radial-gradient(closest-side, transparent 80%, ${style.glow} 89%, transparent 100%)`,
            opacity: busy ? 1 : 0,
            transition: 'opacity 320ms ease',
            animation: busy ? `${breathe} 1.8s ease-in-out infinite` : 'none',
          },
          '& .pp-ring': {
            position: 'absolute',
            top: -9,
            right: -9,
            bottom: -9,
            left: -9,
            zIndex: 1,
            borderRadius: '50%',
            pointerEvents: 'none',
            background:
              'conic-gradient(from 210deg, var(--pp-ring-a), var(--pp-ring-b), var(--pp-ring-c), var(--pp-ring-a))',
            WebkitMask: RING_MASK,
            mask: RING_MASK,
            animation: busy ? `${spin} 1.4s linear infinite` : 'none',
          },
          [reducedMotion]: {
            '& .pp-glow': { animation: 'none', opacity: busy ? 0.7 : 0 },
            '& .pp-ring': { animation: 'none' },
          },
        }
      }}
    >
      <Box component="span" aria-hidden className="pp-glow" />
      <Box component="span" aria-hidden className="pp-ring" />
      <ButtonBase
        disableRipple
        disabled={disabled}
        onClick={onClick}
        data-tone={tone}
        className="pewpew-power"
        sx={(theme) => {
          const light = isLightTheme(theme)
          const style = toneStyle(theme, tone)
          const highlight = light ? LIGHT_HIGHLIGHT : DARK_HIGHLIGHT
          return {
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 2,
            borderRadius: '50%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            px: 2,
            textAlign: 'center',
            color: style.color,
            background: light
              ? tone === 'unavailable'
                ? 'radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.8), rgba(240, 244, 250, 0.62))'
                : 'radial-gradient(circle at 50% 30%, #ffffff 0%, rgba(244, 247, 255, 0.95) 55%, rgba(226, 235, 255, 0.9) 100%)'
              : tone === 'unavailable'
                ? 'radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03))'
                : 'radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.17) 0%, rgba(255, 255, 255, 0.07) 60%, rgba(255, 255, 255, 0.04) 100%)',
            border: `1px solid ${light ? alpha('#ffffff', 0.9) : alpha('#ffffff', 0.12)}`,
            boxShadow: `${style.drop}, ${highlight} !important`,
            transition:
              'transform 180ms ease, color 320ms ease, box-shadow 320ms ease',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: `${style.hoverDrop}, ${highlight} !important`,
            },
            '&:active': { transform: 'scale(0.98)' },
            '&.Mui-disabled': { color: style.color },
            // Doubled class so it outranks the shell-wide :focus-visible rule.
            '&.Mui-focusVisible.Mui-focusVisible': {
              outline: `2px solid ${alpha(brandColor(theme), 0.75)} !important`,
              outlineOffset: '14px',
            },
            '& .pp-icon': {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: compact ? 34 : { xs: 38, sm: 44 },
              '& .MuiSvgIcon-root': {
                fontSize: compact ? 34 : { xs: 38, sm: 44 },
              },
            },
            '& .pp-label': {
              mt: 0.5,
              maxWidth: compact ? 84 : { xs: 100, sm: 116 },
              fontSize: compact ? 14 : { xs: 15, sm: 16 },
              fontWeight: 800,
              lineHeight: 1.25,
              overflowWrap: 'anywhere',
            },
            [reducedMotion]: {
              transition: 'color 320ms ease, box-shadow 320ms ease',
              '&:hover, &:active': { transform: 'none' },
            },
          }
        }}
      >
        <Box component="span" className="pp-icon">
          {spinning ? (
            <CircularProgress size={34} thickness={3.8} color="inherit" />
          ) : (
            <PowerSettingsNewRounded />
          )}
        </Box>
        <Box component="span" className="pp-label">
          {label}
        </Box>
      </ButtonBase>
    </Box>
  )
}
