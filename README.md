# PewPew 云客户端

PewPew 云客户端是面向 PewPew 云用户的简化版桌面客户端，用于导入订阅链接、选择线路并一键开启网络连接。

本项目基于 Clash Verge Rev、mihomo / Clash.Meta 与 Tauri 构建，不重写网络内核，只针对 PewPew 云使用场景做品牌化与客户版界面简化。

## 下载

**Windows x64 内测修复版（0.1.3，2026-10-07）：[下载安装包（.exe）](https://github.com/xinlexu/pewpew-client/releases/download/v0.1.3-windows-test.20261007/PewPewCloud_0.1.3_windows-x64_test-20261007_setup.exe)**

[查看版本说明](https://github.com/xinlexu/pewpew-client/releases/tag/v0.1.3-windows-test.20261007) · [SHA-256 校验文件](https://github.com/xinlexu/pewpew-client/releases/download/v0.1.3-windows-test.20261007/SHA256SUMS.txt)

- 本包未签名，仅供内部测试。Windows 可能提示未知发布者，请确认下载来源并核对校验值。
- 本包已包含新版界面、标准 / 增强兼容模式，以及导入、线路选择和连接状态相关修复。
- 修复 Windows 增强兼容模式安装后台服务时的路径引号问题，并区分取消授权与安装失败。自动化检查已通过，首次系统授权和实际增强兼容连接仍需在目标电脑验证；若仍失败，请复制诊断信息联系客服。
- 修复覆盖旧版时内核文件被占用导致的写入失败。若旧安装器正在报错，请先点击“中止”，不要选择“忽略”，再使用本包重试；无需删除订阅配置。
- macOS（Apple 芯片 / Intel）暂未发布 PewPew 测试包。

## 主要功能

- 导入 PewPew 云订阅链接
- 更新线路订阅
- 显示剩余流量、下次重置时间、套餐到期时间
- 选择可用线路
- 切换智能模式 / 全局模式
- 一键开启或关闭 PewPew 云
- 展示客服微信：`PewPew_VPN`
- 保留开源许可与上游致谢

## 使用说明

1. 打开 PewPew 云客户端。
2. 粘贴 PewPew 云订阅链接并导入线路。
3. 在线路列表中选择合适的线路。
4. 按需选择智能模式或全局模式。
5. 点击“开启 PewPew 云”开始使用。

如需帮助，请联系 PewPew 云客服微信：`PewPew_VPN`。

## 开发

本项目使用 Tauri、React、TypeScript、Rust 与 mihomo / Clash.Meta。

本地开发命令：

```shell
pnpm i
pnpm run prebuild
pnpm dev
```

前端构建检查：

```shell
pnpm web:build
```

## 上游致谢

PewPew 云客户端基于以下开源项目构建：

- [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev)
- [mihomo / Clash.Meta](https://github.com/MetaCubeX/mihomo)
- [Tauri](https://github.com/tauri-apps/tauri)
- [Vite](https://github.com/vitejs/vite)

感谢上述项目及社区贡献者。

## 开源许可

本项目遵守 GPL-3.0 开源许可。详情请查看 [LICENSE](./LICENSE)。
