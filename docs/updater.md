# 应用内更新：发布步骤

客户端在「关于 → 检查更新」里读取 PewPew 的更新通道：

```
https://github.com/xinlexu/pewpew-client/releases/download/updater/latest.json
```

`latest.json` 写明最新版本号、更新说明和 Windows 安装包的下载地址与签名。客户端下载安装包后，会先用内置公钥校验签名，校验不通过就不安装。安装前客户端会像正常退出一样恢复系统代理、关闭增强兼容并停止连接核心，再以 `/P /R` 参数运行安装包：安装过程只显示进度，装完后自动重启客户端。

只有上传了 `latest.json` 的版本才会推送给用户。0.1.4 及更早的版本没有这个功能，需要手动安装一次带更新功能的版本。

## 一次性准备：生成签名密钥

本机密钥已生成，存放在项目目录 `H:\Projects\PewPewClient\pewpew-updater.key`，不设密码。私钥及本地公钥文件均由本地 Git 排除规则排除，不得提交、上传或整体分享项目目录。不要重新生成或覆盖现有密钥。

以下命令仅用于没有密钥的新环境，必须先确认文件不存在：

```powershell
if (Test-Path H:\Projects\PewPewClient\pewpew-updater.key) { throw "Existing key must not be replaced" }
pnpm tauri signer generate -w H:\Projects\PewPewClient\pewpew-updater.key --ci
```

- `pewpew-updater.key` 就是发布更新的钥匙，不要提交到仓库，也不要发给别人。
- 这个文件丢了，已安装的客户端就收不到自动更新，只能让用户手动装一次新版本。想更稳妥，可以自己再存一份。
- 把生成的 `pewpew-updater.key.pub` 文件内容（一整行 base64）填进 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，替换掉从 Clash Verge 继承来的公钥，然后提交。
- 公钥必须在**第一个带更新功能的版本打包之前**换好。用旧公钥打出的客户端无法验证 PewPew 签的更新。

## 每次发布

1. 照常更新版本号并打包（`createUpdaterArtifacts` 保持 `false`，签名单独做）。
2. 给安装包签名，生成同名的 `.sig` 文件：

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   pnpm tauri signer sign -f H:\Projects\PewPewClient\pewpew-updater.key --password= "<安装包.exe>"
   ```

3. 照常把安装包上传到这个版本的 Release。
4. 生成 `latest.json`。脚本会用 `tauri.conf.json` 里的公钥验证签名；如果密钥不配对、安装包被改动，或者还是 Clash Verge 的公钥，它会报错并且不生成文件：

   ```powershell
   node scripts/pewpew-update-manifest.mjs `
     --installer "<安装包.exe>" `
     --url "https://github.com/xinlexu/pewpew-client/releases/download/<版本 tag>/<安装包.exe>" `
     --notes "<更新说明.md>" `
     --out target\latest.json
   ```

   `--url` 必须是第 3 步上传后的真实下载地址。更新说明支持 Markdown，会显示在客户端的更新窗口里。

5. 把 `target\latest.json` 上传到 tag 为 `updater` 的 Release，覆盖旧文件。第一次需要先创建这个 Release，并勾选 pre-release，避免它变成 GitHub 首页的「Latest」：

   ```powershell
   gh release create updater --prerelease --title "PewPew 更新通道" --notes "客户端自动更新读取的文件，请勿删除。"
   gh release upload updater target\latest.json --clobber
   ```

## 发布前自测

在测试电脑上装上一个旧版本（需带更新功能），打开「关于 → 检查更新」，确认能看到新版本、下载进度正常，安装后客户端自动重启并恢复原来的连接。

国内用户访问 GitHub 可能不稳定。客户端会先通过自己的连接核心检查更新，失败后再直连 GitHub。
