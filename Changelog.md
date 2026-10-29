# PewPew 云客户端版本记录

[当前下载入口](README.md#下载) · [全部发布记录](https://github.com/xinlexu/pewpew-client/releases)

截至 2026-10-29，以下 PewPew 版本均为 Windows x64 未签名内测版。版本说明记录当时的修改和检查范围，不代表已完成所有实机验证。

## 0.1.6 — 2026-10-29

[完整发布说明](https://github.com/xinlexu/pewpew-client/releases/tag/v0.1.6-windows-test.20261029)

- Windows 后台服务、控制管道和状态目录改用 PewPew 独立名称，服务程序由仓库源码编译。
- 安装器仅迁移本安装目录所属的旧服务；升级后首次开启增强兼容会请求管理员授权。
- 全局模式提示国内网站可能变慢，测速提示在测完后切回智能模式。
- 对齐首页两处切换条，并为刷新延迟使用独立图标。
- 保留原有 mihomo 内核、GPL-3.0 和上游致谢；自动更新通道保持关闭。

## 0.1.5 — 2026-10-28

[完整发布说明](https://github.com/xinlexu/pewpew-client/releases/tag/v0.1.5-windows-test.20261028)

- 独立内核控制通道，默认代理端口改为 7966，增加其他代理软件和端口占用提示。
- 增加客服二维码、反馈诊断信息、测速及应用内更新界面；自动更新通道等待真机验证后启用，0.1.4 用户需手动安装。
- 增强兼容下对 Discord 保守短测择优，手动选线优先；检测目的地并非 Discord，不能保证直播提速。
- 改进退出和更新前网络清理及失败恢复，保留安装器加固流程；既有整机卡死和退出问题仍需真机复验。
- 本次仅发布 Windows x64 内测包，未验证 macOS。

## 0.1.4 — 2026-10-07

[完整发布说明](https://github.com/xinlexu/pewpew-client/releases/tag/v0.1.4-windows-test.20261007)

- 调整安装与卸载流程，等待客户端退出，并核对残留核心所属路径。
- 改进 Windows 服务路径处理、文件写入检查和分阶段安装日志。
- 已报告后台退出卡住；0.1.3 安装时整机无响应的根因仍未确认。当前内测包不能宣称已解决这些问题。

## 0.1.3 — 2026-10-07

[完整发布说明](https://github.com/xinlexu/pewpew-client/releases/tag/v0.1.3-windows-test.20261007)

- 修复增强兼容模式安装服务时的提权路径引号处理，区分取消授权与安装失败。
- 补充服务安装诊断。后续收到安装期间整机无响应的反馈，保留本版本用于追溯。

## 0.1.2 — 2026-10-07

[完整发布说明](https://github.com/xinlexu/pewpew-client/releases/tag/v0.1.2-windows-test.20261007)

- 改进旧版升级时的内核文件占用处理、写入权限检查和失败重试。
- 保留用户订阅配置及原有界面；安装流程后续继续在 0.1.4 中调整。

## 0.1.1 — 2026-10-07

[完整发布说明](https://github.com/xinlexu/pewpew-client/releases/tag/v0.1.1-windows-test.20261007)

- 更新首页、浅色与深色外观、订阅和线路信息展示。
- 加入标准与增强兼容模式，并改进连接、导入和线路切换时的状态协调。

## 0.1.0 — 2026-10-04

[完整发布说明](https://github.com/xinlexu/pewpew-client/releases/tag/v0.1.0-windows-test.20261004)

- 发布 Windows x64 内测包，改进订阅导入、更新和嵌套线路组选择。
- 统一 PewPew 图标，并收窄安装器对其他客户端和网络设置的影响。

## 历史 AutoBuild 与上游记录

- [2026 年 5 月 AutoBuild](https://github.com/xinlexu/pewpew-client/releases/tag/autobuild) 是早期历史构建，不作为当前下载入口，其平台附件不代表当前支持范围。
- [上游历史版本记录](docs/Changelog.history.md) 保留 Clash Verge Rev 的历史信息。
- [整理前的上游 v2.5.2 记录](https://github.com/xinlexu/pewpew-client/blob/e4903de22d13865a4bce3fcd6db188ee4d50d6b5/Changelog.md) 可通过 Git 历史查阅。
