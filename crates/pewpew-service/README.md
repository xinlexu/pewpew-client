# PewPew 后台服务

PewPew 增强兼容模式（TUN）用的 Windows 后台服务，以及客户端连接它的 IPC 库。

源码来自 [clash-verge-rev/clash-verge-service-ipc](https://github.com/clash-verge-rev/clash-verge-service-ipc) 2.3.0，提交 `21e661fa141e5ad3c705ee4cdb86efff8df6f769`，按 GPL-3.0 使用（见 `LICENSE`）。

## 为什么要自己编译

上游服务在 Windows 上的服务名、管道名和状态目录都是写死的。PewPew 用上游二进制时，和 Clash Verge 的后台服务完全同名：装了 Clash Verge 服务的电脑上，PewPew 的增强兼容用不了。

## 和上游的差别（只改 Windows）

| 项目 | 上游 | PewPew |
| --- | --- | --- |
| 服务名 | `clash_verge_service` | `pewpew_service` |
| 显示名称 | Clash Verge Service | PewPew Background Service |
| IPC 管道 | `\\.\pipe\clash-verge-service` | `\\.\pipe\pewpew-service` |
| 运行目录、状态目录 | `clash-verge-service` | `pewpew-service` |
| 默认内核管道 | `\\.\pipe\verge-mihomo` | `\\.\pipe\pewpew-mihomo` |

改动只在字符串上，改过的文件开头都有注明。可执行文件名（`clash-verge-service*.exe`）、IPC 协议和版本号（2.3.0）都没变。macOS 和 Linux 部分保持上游原样。

## 编译

正式打包时，`tauri build` 会先运行 `scripts/build-pewpew-service.mjs`。这个脚本编译三个 Windows 程序，再复制到 `src-tauri/resources/`。本地调试增强兼容模式时，先手动运行一次：

```powershell
node scripts/build-pewpew-service.mjs
```

这个 crate 不在 Cargo workspace 里（见根目录 `Cargo.toml` 的 `exclude`），单独编译时用自己的 `Cargo.lock`。客户端以 path 依赖的方式使用它的 `client` 功能。
