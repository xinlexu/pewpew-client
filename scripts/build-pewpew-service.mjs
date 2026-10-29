// Builds PewPew's background service (crates/pewpew-service) and copies it to
// src-tauri/resources, where the Windows installer picks it up. `tauri build`
// runs this before every build (see beforeBuildCommand); other platforms skip
// it and keep the upstream service that `pnpm prebuild` downloads.
//
//   node scripts/build-pewpew-service.mjs            build and copy
//   node scripts/build-pewpew-service.mjs --verify   only check the copies
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const crate = path.join(root, 'crates/pewpew-service/Cargo.toml')
const resources = path.join(root, 'src-tauri/resources')
const targetDir = path.join(root, 'target/pewpew-service')
const binaries = [
  'clash-verge-service',
  'clash-verge-service-install',
  'clash-verge-service-uninstall',
]
// Every PewPew build of these programs names the PewPew service; the upstream
// downloads name `clash_verge_service` instead.
const markers = [
  Buffer.from('pewpew_service'),
  Buffer.from('pewpew_service', 'utf16le'),
]
export const isPewPewServiceBuild = (bytes) =>
  markers.some((marker) => bytes.includes(marker))

const windowsArch = {
  x86_64: 'x86_64',
  x64: 'x86_64',
  aarch64: 'aarch64',
  arm64: 'aarch64',
  i686: 'i686',
  ia32: 'i686',
}

export function windowsTarget(
  env = process.env,
  argv = process.argv,
  host = process,
) {
  const flag = argv.indexOf('--target')
  if (flag >= 0 && argv[flag + 1]) return argv[flag + 1]
  if (env.TAURI_ENV_TARGET_TRIPLE) return env.TAURI_ENV_TARGET_TRIPLE
  if (env.TAURI_ENV_PLATFORM) {
    if (env.TAURI_ENV_PLATFORM !== 'windows') return null
    const arch = windowsArch[env.TAURI_ENV_ARCH]
    if (!arch)
      throw new Error(`Unsupported Windows architecture: ${env.TAURI_ENV_ARCH}`)
    return `${arch}-pc-windows-msvc`
  }
  if (host.platform !== 'win32') return null
  return `${windowsArch[host.arch] ?? 'x86_64'}-pc-windows-msvc`
}

async function verify() {
  for (const name of binaries) {
    const file = path.join(resources, `${name}.exe`)
    const bytes = await readFile(file).catch(() => null)
    if (!bytes)
      throw new Error(
        `Missing ${file}. Run: node scripts/build-pewpew-service.mjs`,
      )
    if (!isPewPewServiceBuild(bytes)) {
      throw new Error(
        `${file} is not PewPew's build of the service (it does not name pewpew_service).`,
      )
    }
  }
  console.log("[pewpew-service] resources contain PewPew's service build")
}

async function main() {
  if (process.argv.includes('--verify')) return verify()

  const target = windowsTarget()
  if (!target) {
    console.log('[pewpew-service] not a Windows build; skipped')
    return
  }
  if (!target.includes('-windows-')) {
    console.log(`[pewpew-service] ${target} is not a Windows target; skipped`)
    return
  }

  console.log(`[pewpew-service] building for ${target}`)
  execFileSync(
    'cargo',
    [
      'build',
      '--release',
      '--locked',
      '--manifest-path',
      crate,
      '--features',
      'standalone',
      '--target',
      target,
      '--target-dir',
      targetDir,
      ...binaries.flatMap((name) => ['--bin', name]),
    ],
    { stdio: 'inherit' },
  )

  await mkdir(resources, { recursive: true })
  for (const name of binaries) {
    await copyFile(
      path.join(targetDir, target, 'release', `${name}.exe`),
      path.join(resources, `${name}.exe`),
    )
  }
  await verify()
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main()
}
