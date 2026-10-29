import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  isPewPewServiceBuild,
  windowsTarget,
} from '../scripts/build-pewpew-service.mjs'

const read = (file) =>
  readFile(new URL(`../${file}`, import.meta.url), 'utf8').then((text) =>
    text.replaceAll('\r\n', '\n'),
  )

test('the background service is built only for Windows targets', () => {
  const linux = { platform: 'linux', arch: 'x64' }
  const windows = { platform: 'win32', arch: 'x64' }
  const tauri = (platform, arch) => ({
    TAURI_ENV_PLATFORM: platform,
    TAURI_ENV_ARCH: arch,
  })
  assert.equal(
    windowsTarget(tauri('windows', 'x86_64'), [], linux),
    'x86_64-pc-windows-msvc',
  )
  assert.equal(
    windowsTarget(tauri('windows', 'aarch64'), [], linux),
    'aarch64-pc-windows-msvc',
  )
  assert.equal(windowsTarget(tauri('macos', 'aarch64'), [], windows), null)
  assert.equal(windowsTarget({}, [], windows), 'x86_64-pc-windows-msvc')
  assert.equal(windowsTarget({}, [], linux), null)
  assert.equal(
    windowsTarget(
      {},
      ['node', 'build', '--target', 'i686-pc-windows-msvc'],
      linux,
    ),
    'i686-pc-windows-msvc',
  )
  assert.equal(
    windowsTarget(
      { TAURI_ENV_TARGET_TRIPLE: 'aarch64-pc-windows-msvc' },
      [],
      linux,
    ),
    'aarch64-pc-windows-msvc',
  )
  assert.throws(
    () => windowsTarget(tauri('windows', 'riscv64'), [], linux),
    /Unsupported Windows architecture/,
  )
})

test('the service, the client and the installer agree on the Windows names', async () => {
  const [lib, install, uninstall, service, client, installer] =
    await Promise.all([
      read('crates/pewpew-service/src/lib.rs'),
      read('crates/pewpew-service/src/bin/install_service.rs'),
      read('crates/pewpew-service/src/bin/uninstall_service.rs'),
      read('crates/pewpew-service/src/bin/service.rs'),
      read('src-tauri/src/core/service.rs'),
      read('src-tauri/packages/windows/installer.nsi'),
    ])

  assert.match(
    lib,
    /#\[cfg\(all\(windows, not\(feature = "test"\)\)\)\]\npub static IPC_PATH: &str = r"\\\\\.\\pipe\\pewpew-service";/,
  )
  assert.match(install, /name: OsString::from\("pewpew_service"\)/)
  assert.match(install, /open_service\("pewpew_service"/)
  assert.match(uninstall, /open_service\("pewpew_service"/)
  assert.equal(service.split('"pewpew_service"').length - 1, 2)
  assert.match(client, /const WINDOWS_SERVICE_NAME: &str = "pewpew_service";/)
  assert.match(installer, /!define PEWPEW_SERVICE "pewpew_service"/)

  // Clash Verge's name may only appear where the old registration is removed.
  for (const text of [lib, install, uninstall, service]) {
    assert.ok(!text.includes('"clash_verge_service"'))
    assert.ok(!text.includes('pipe\\clash-verge-service"'))
  }
  assert.ok(!client.includes('"clash_verge_service"'))
  assert.equal(installer.split('"clash_verge_service"').length - 1, 1)
})

test('only PewPew builds of the service pass the bundle check', () => {
  const program = (text, encoding) =>
    Buffer.concat([Buffer.from('MZ\0\0'), Buffer.from(text, encoding)])
  assert.ok(isPewPewServiceBuild(program('open pewpew_service', 'utf8')))
  assert.ok(isPewPewServiceBuild(program('pewpew_service', 'utf16le')))
  assert.ok(!isPewPewServiceBuild(program('clash_verge_service', 'utf8')))
  assert.ok(!isPewPewServiceBuild(program('clash_verge_service', 'utf16le')))
})
