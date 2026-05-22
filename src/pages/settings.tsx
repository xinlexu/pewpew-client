import { ArrowBackRounded } from '@mui/icons-material'
import { Box, Button, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router'

import { BasePage } from '@/components/base'

const SettingPage = () => {
  return (
    <BasePage
      title="关于 / 开源许可"
      header={
        <Button
          component={RouterLink}
          to="/"
          size="small"
          startIcon={<ArrowBackRounded />}
          sx={{ borderRadius: 999 }}
        >
          返回首页
        </Button>
      }
      contentStyle={{ padding: 2 }}
    >
      <Box
        sx={(theme) => ({
          maxWidth: 760,
          borderRadius: 1,
          border: `1px solid ${theme.palette.divider}`,
          bgcolor:
            theme.palette.mode === 'light'
              ? 'rgba(255,255,255,0.92)'
              : 'rgba(36,37,47,0.92)',
          p: 2.5,
        })}
      >
        <Stack spacing={2}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 800, mb: 0.75 }}>
              PewPew 云客户端
            </Typography>
            <Typography variant="body2" color="text.secondary">
              本客户端用于导入 PewPew 云订阅、选择节点并开启 PewPew 云网络开关。
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.75 }}>
              开源许可
            </Typography>
            <Typography variant="body2" color="text.secondary">
              本客户端遵守 GPL-3.0 开源许可。
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.75 }}>
              上游致谢
            </Typography>
            <Stack spacing={0.5}>
              <Typography variant="body2" color="text.secondary">
                PewPew 云客户端基于 Clash Verge Rev、mihomo / Clash.Meta、Tauri
                构建。
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Clash Verge Rev:
                https://github.com/clash-verge-rev/clash-verge-rev
              </Typography>
              <Typography variant="body2" color="text.secondary">
                mihomo / Clash.Meta: https://github.com/MetaCubeX/mihomo
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Tauri: https://tauri.app/
              </Typography>
            </Stack>
          </Box>

          <Typography variant="caption" color="text.secondary">
            客服微信：PewPew_VPN
          </Typography>
        </Stack>
      </Box>
    </BasePage>
  )
}

export default SettingPage
