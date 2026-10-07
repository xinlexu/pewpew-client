import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Run from an x64 Visual Studio Native Tools terminal with Tauri's NSIS cache installed.
if (process.platform !== 'win32') {
  throw new Error('This test exercises native Windows installer APIs.')
}

const root = fileURLToPath(new URL('../../', import.meta.url))
const template = (
  await readFile(
    path.join(root, 'src-tauri/packages/windows/installer.nsi'),
    'utf8',
  )
).replaceAll('\r\n', '\n')
const macro = (name) => {
  const start = template.indexOf(`!macro ${name}\n`)
  const end = template.indexOf('!macroend', start)
  assert.ok(start >= 0 && end > start, `Missing ${name} macro`)
  return template.slice(start, end + '!macroend'.length)
}
const work = path.join(root, 'target/installer-upgrade-tests', `${Date.now()}`)
const own = path.join(work, 'PewPew cloud 中文')
const other = path.join(work, 'another client')
await mkdir(own, { recursive: true })
await mkdir(other, { recursive: true })
const makensis = path.join(process.env.LOCALAPPDATA, 'tauri/NSIS/makensis.exe')
const escape = (value) => value.replaceAll('$', '$$').replaceAll('"', '$\\"')
const executableNames = ['verge-mihomo.exe', 'verge-mihomo-alpha.exe']
let sequence = 0

async function harness(stopCores, installDirectory = own) {
  const id = ++sequence
  const script = path.join(work, `check-${id}.nsi`)
  const output = path.join(work, `check-${id}.exe`)
  await writeFile(
    script,
    `Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${escape(output)}"
!include LogicLib.nsh
Var PewPewBlockedFile
${macro('PewPewStopOwnCores')}
${macro('PewPewCheckWritable FILE')}
Section
  StrCpy $INSTDIR "${escape(installDirectory)}"
  StrCpy $0 "preserved-register"
  StrCpy $PewPewBlockedFile ""
  ${stopCores ? '!insertmacro PewPewStopOwnCores' : ''}
  ${executableNames.map((name) => `!insertmacro PewPewCheckWritable "$INSTDIR\\${name}"`).join('\n  ')}
  \${If} $0 != "preserved-register"
    SetErrorLevel 43
  \${ElseIf} $PewPewBlockedFile != ""
    SetErrorLevel 42
  \${Else}
    SetErrorLevel 0
  \${EndIf}
SectionEnd
`,
    'utf8',
  )
  execFileSync(makensis, ['/V2', '/INPUTCHARSET', 'UTF8', script], {
    windowsHide: true,
    stdio: 'pipe',
  })
  try {
    execFileSync(output, ['/S'], { windowsHide: true, timeout: 30000 })
    return 0
  } catch (error) {
    if (typeof error.status === 'number') return error.status
    throw error
  }
}

const children = []
const start = async (exe, args) => {
  const child = spawn(exe, args, { windowsHide: true, stdio: 'ignore' })
  children.push(child)
  await once(child, 'spawn')
  return child
}

try {
  assert.equal(await harness(true), 0, 'A new installation must pass')
  console.log('PASS: missing files do not block a fresh install')

  const fixture = path.join(work, 'idle-core.c')
  const fixtureExe = path.join(work, 'idle-core.exe')
  await writeFile(
    fixture,
    `#include <windows.h>
int wmain(int argc, wchar_t **argv) {
  HANDLE file = INVALID_HANDLE_VALUE;
  if (argc == 2) {
    file = CreateFileW(argv[1], GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
    if (file == INVALID_HANDLE_VALUE) return 3;
  }
  Sleep(120000);
  if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
  return 0;
}
`,
  )
  execFileSync(
    'cl.exe',
    [
      '/nologo',
      fixture,
      `/Fe:${fixtureExe}`,
      `/Fo:${path.join(work, 'idle-core.obj')}`,
    ],
    {
      cwd: work,
      windowsHide: true,
      stdio: 'pipe',
    },
  )
  const fixtureBytes = await readFile(fixtureExe)
  assert.equal(
    fixtureBytes.readUInt16LE(fixtureBytes.readUInt32LE(0x3c) + 4),
    0x8664,
    'Use the x64 compiler to exercise cross-architecture process handling',
  )
  for (const name of [...executableNames, 'unrelated.exe']) {
    await copyFile(fixtureExe, path.join(own, name))
  }
  await copyFile(fixtureExe, path.join(other, executableNames[0]))
  const before = await readFile(path.join(own, executableNames[0]))
  assert.equal(await harness(false), 0, 'Closed files must remain writable')
  assert.deepEqual(await readFile(path.join(own, executableNames[0])), before)
  console.log('PASS: preflight never truncates an existing executable')

  const cores = []
  for (const name of executableNames)
    cores.push(await start(path.join(own, name), []))
  const unrelated = await start(path.join(own, 'unrelated.exe'), [])
  const foreign = await start(path.join(other, executableNames[0]), [])
  assert.equal(
    await harness(false),
    42,
    'A running core must reproduce the write lock',
  )
  assert.equal(
    await harness(true),
    0,
    'Owned cores must be released before copying',
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(
    cores.every((child) => child.exitCode !== null),
    'Owned cores must exit',
  )
  assert.equal(
    unrelated.exitCode,
    null,
    'Do not stop other executables in the install directory',
  )
  assert.equal(
    foreign.exitCode,
    null,
    'Do not stop same-named cores in other directories',
  )
  assert.deepEqual(await readFile(path.join(own, executableNames[0])), before)
  console.log(
    'PASS: locked stable/alpha cores are released; unrelated processes survive',
  )

  const locker = await start(fixtureExe, [path.join(own, executableNames[0])])
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(locker.exitCode, null, 'File-lock fixture must be running')
  assert.equal(
    await harness(true),
    42,
    'An external file lock must block replacement',
  )
  assert.equal(
    locker.exitCode,
    null,
    'Do not terminate an unrelated file-lock owner',
  )
  const unlocked = once(locker, 'exit')
  locker.kill()
  await unlocked
  assert.equal(
    await harness(true),
    0,
    'Retry must pass after the external lock is released',
  )
  assert.deepEqual(await readFile(path.join(own, executableNames[0])), before)
  console.log(
    'PASS: external locks block copying without data loss; retry succeeds after release',
  )

  const mainCopy = template.indexOf('  File "${MAINBINARYSRCPATH}"')
  const installStart = template.indexOf('Section Install\n')
  const prepareCall = template.indexOf(
    '  Call PewPewPrepareFiles',
    installStart,
  )
  assert.ok(prepareCall > installStart && prepareCall < mainCopy)
  assert.ok(template.includes('Call un.PewPewPrepareFiles'))
  assert.ok(template.includes('MB_RETRYCANCEL'))
  assert.ok(template.includes('i 0x40000000, i 7, p 0, i 3'))
  console.log(
    'PASS: installer and uninstaller preflight precedes file replacement/removal',
  )
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
  }
}
