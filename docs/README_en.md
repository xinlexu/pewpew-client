# PewPew Cloud Client

[简体中文](../README.md) · English · [Español](README_es.md) · [فارسی](README_fa.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Русский](README_ru.md)

A desktop client for PewPew Cloud subscriptions, built on Clash Verge Rev, mihomo / Clash.Meta, Tauri, React, TypeScript and Rust. It provides subscription import, server selection, usage information and connection controls.

## Downloads and release status

Start with the [current download section](../README.md#下载) and read the matching release notes and `SHA256SUMS.txt`. Packages are published in [this repository's Releases](https://github.com/xinlexu/pewpew-client/releases).

As of 2026-10-08, the current package is **0.1.4 for Windows x64, an unsigned internal test build**. It is not a stable release. A system freeze was reported during 0.1.3 installation, and a background-exit problem was reported with 0.1.4; neither root cause has been confirmed. Test in a Windows VM with a snapshot before considering wider use. No current macOS test package has been published.

The old `autobuild` release is retained as a historical build. It does not establish current platform support. Automatic updates are not enabled for the current test package.

## Basic usage

1. Import a PewPew Cloud subscription URL.
2. Update the subscription and select a server.
3. Select the routing and connection mode appropriate for the test.
4. Connect or disconnect using the main control.

Before upgrading, disconnect and exit the old client from the tray. If the installer reports an error, cancel instead of ignoring it. Keep the error message and relevant diagnostic details; do not delete subscription data as a troubleshooting shortcut.

## Feedback

Use [PewPew issue templates](https://github.com/xinlexu/pewpew-client/issues/new/choose) for this client's bugs, feature requests and translations. Include the exact version and reproduction steps. Public reports must omit subscription URLs, credentials and personal information. Subscription/account questions should use the support contact listed in the [main README](../README.md#使用说明).

Do not send PewPew-specific issues to the upstream project unless the same issue has been reproduced in its unmodified release.

## Development

See [CONTRIBUTING.md](../CONTRIBUTING.md) for prerequisites, commands and validation. See [Changelog.md](../Changelog.md) for PewPew release history and known limitations.

## Upstream and license

This client builds on [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev), [mihomo](https://github.com/MetaCubeX/mihomo), [Tauri](https://github.com/tauri-apps/tauri) and [Vite](https://github.com/vitejs/vite). Upstream acknowledgements and the [GPL-3.0 license](../LICENSE) are retained. [Historical upstream release notes](Changelog.history.md) describe the upstream project, not PewPew's current release status.
