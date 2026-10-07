import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Run from an x64 Visual Studio Native Tools terminal with Tauri's NSIS cache installed
// (or point MAKENSIS at makensis.exe). Only the installer helpers are exercised, against
// fixture processes in a temporary folder: no real installation, background service or
// TUN adapter is touched, and no installer or uninstaller is run.
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
const section = (name) => {
  const start = template.indexOf(`Section ${name}\n`)
  const end = template.indexOf('SectionEnd', start)
  assert.ok(start >= 0 && end > start, `Missing ${name} section`)
  return template.slice(start, end)
}
const fn = (name) => {
  const start = template.indexOf(`Function ${name}\n`)
  const end = template.indexOf('FunctionEnd', start)
  assert.ok(start >= 0 && end > start, `Missing ${name} function`)
  return template.slice(start, end)
}
const inOrder = (text, parts, message) => {
  let at = -1
  for (const part of parts) {
    const next = text.indexOf(part, at + 1)
    assert.ok(next > at, `${message}: "${part}" is missing or out of order`)
    at = next
  }
}

const work = path.join(root, 'target/installer-upgrade-tests', `${Date.now()}`)
const own = path.join(work, 'PewPew cloud 中文')
const other = path.join(work, 'another client')
const logFile = path.join(work, 'logs', 'installer.log')
await mkdir(own, { recursive: true })
await mkdir(other, { recursive: true })
const makensis =
  process.env.MAKENSIS ??
  path.join(process.env.LOCALAPPDATA, 'tauri/NSIS/makensis.exe')
const escape = (value) => value.replaceAll('$', '$$').replaceAll('"', '$\\"')
const executableNames = ['verge-mihomo.exe', 'verge-mihomo-alpha.exe']
// A unique client name, so a PewPew client running on this computer cannot interfere.
const clientName = `pewpew-test-client-${process.pid}`
let sequence = 0

const prelude = `Unicode true
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
!include FileFunc.nsh
!define VERSION "test"
!define MAINBINARYNAME "${clientName}"
LoadLanguageFile "\${NSISDIR}\\Contrib\\Language files\\English.nlf"
Var PewPewBlockedFile
Var PewPewLogFile
Var PewPewCoreCount
Var PewPewProcessCount
Var PewPewFlushError
Var PassiveMode
LangString pewpewClientRunning \${LANG_ENGLISH} "client running"
LangString pewpewFlushFailed \${LANG_ENGLISH} "not written to disk: $PewPewFlushError"
${macro('PewPewLog TEXT')}
${macro('PewPewWriteLogFunction PREFIX')}
!insertmacro PewPewWriteLogFunction ""
${macro('PewPewCountProcesses NAME')}
${macro('PewPewClientExitFunction PREFIX')}
!insertmacro PewPewClientExitFunction ""
${macro('PewPewPlainPath VAR')}
${macro('PewPewOwnCores TERMINATE')}
${macro('PewPewCheckWritable FILE')}
${macro('PewPewFlushFile FILE')}
${macro('PewPewCheckFlush RETRY')}
`

async function build(body) {
  const id = ++sequence
  const script = path.join(work, `check-${id}.nsi`)
  const output = path.join(work, `check-${id}.exe`)
  await writeFile(
    script,
    `${prelude}OutFile "${escape(output)}"
Section
  StrCpy $PewPewLogFile "${escape(logFile)}"
${body}
SectionEnd
`,
    'utf8',
  )
  execFileSync(makensis, ['/V2', '/INPUTCHARSET', 'UTF8', script], {
    windowsHide: true,
    stdio: 'pipe',
  })
  return output
}

async function run(output, timeout = 60000) {
  const child = spawn(output, ['/S'], { windowsHide: true, stdio: 'ignore' })
  const timer = setTimeout(() => child.kill(), timeout)
  const [code] = await once(child, 'exit')
  clearTimeout(timer)
  assert.equal(typeof code, 'number', `${path.basename(output)} timed out`)
  return code
}

// mode: 'stop' releases owned cores, 'count' only counts them, 'none' skips them.
// Exit codes: 0 ready, 42 blocked, 43 clobbered register, 10 + n cores counted.
async function harness(mode, installDirectory = own) {
  const cores = {
    stop: '!insertmacro PewPewOwnCores 1',
    count: '!insertmacro PewPewOwnCores 0',
    none: '',
  }[mode]
  const writable =
    mode === 'count'
      ? ''
      : executableNames
          .map((name) => `!insertmacro PewPewCheckWritable "$INSTDIR\\${name}"`)
          .join('\n  ')
  const output = await build(`  StrCpy $INSTDIR "${escape(installDirectory)}"
  StrCpy $0 "preserved-register"
  StrCpy $PewPewBlockedFile ""
  ${cores}
  ${writable}
  \${If} $0 != "preserved-register"
    SetErrorLevel 43
  \${ElseIf} $PewPewBlockedFile != ""
    SetErrorLevel 42
  \${ElseIf} "${mode}" == "count"
    IntOp $1 $PewPewCoreCount + 10
    SetErrorLevel $1
  \${Else}
    SetErrorLevel 0
  \${EndIf}`)
  return run(output)
}

// Exit codes: 0 every file written to disk, 2 setup stopped, 43 clobbered register.
async function flushHarness(files) {
  const flushes = files
    .map((file) => `!insertmacro PewPewFlushFile "${escape(file)}"`)
    .join('\n  ')
  const output = await build(`  StrCpy $0 "preserved-register"
  flush_again:
  StrCpy $PewPewFlushError ""
  ${flushes}
  !insertmacro PewPewCheckFlush flush_again
  \${If} $0 != "preserved-register"
    SetErrorLevel 43
  \${Else}
    SetErrorLevel 0
  \${EndIf}`)
  return run(output)
}

const readLog = async () => {
  const bytes = await readFile(logFile)
  assert.equal(
    bytes.readUInt16LE(0),
    0xfeff,
    'The setup log is UTF-16 with a BOM',
  )
  return bytes.subarray(2).toString('utf16le')
}

const children = []
const start = async (exe, args) => {
  const child = spawn(exe, args, { windowsHide: true, stdio: 'ignore' })
  children.push(child)
  await once(child, 'spawn')
  return child
}
const stop = async (child) => {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill()
    await exited
  }
}

try {
  // Static order checks on the template.
  const install = section('Install')
  const uninstall = section('Uninstall')
  assert.ok(
    !template.includes('!insertmacro CheckIfAppIsRunning'),
    'Setup and uninstall must not terminate the client',
  )
  inOrder(
    install,
    [
      'Call PewPewWaitForClientExit',
      'Call PewPewPrepareFiles',
      'File "${MAINBINARYSRCPATH}"',
      'File /a "/oname={{this}}"',
      'flush_installed_files:',
      '!insertmacro PewPewFlushFile',
      '!insertmacro PewPewCheckFlush flush_installed_files',
      '!insertmacro PewPewServiceAction "start"',
      'WriteUninstaller',
      'MUI_STARTMENU_WRITE_BEGIN',
    ],
    'Install order',
  )
  inOrder(
    uninstall,
    [
      'Call un.PewPewWaitForClientExit',
      'Call un.PewPewPrepareFiles',
      'PewPewServiceAction "remove"',
    ],
    'Uninstall order',
  )
  inOrder(
    fn('PageLeaveReinstall'),
    ['reinst_uninstall:', 'Call PewPewWaitForClientExit', "ExecWait '$R1' $0"],
    'The previous uninstaller runs only after the client has exited',
  )
  inOrder(
    fn('.onInit'),
    ['PewPewInitLog', 'SetContext', 'PewPewLog'],
    '.onInit log',
  )
  inOrder(
    fn('un.onInit'),
    ['PewPewInitLog', 'SetContext', 'PewPewLog'],
    'un.onInit log',
  )
  const cores = macro('PewPewOwnCores TERMINATE')
  inOrder(
    cores,
    [
      '$5 == "verge-mihomo.exe"',
      'OpenProcess(i 0x1000,',
      'OpenProcess(i 0x101001,',
      'TerminateProcess',
      'WaitForSingleObject(p r4, i 10000)',
    ],
    'Cores are filtered by name and identified with query rights before terminate rights',
  )
  assert.equal(cores.split('OpenProcess(').length - 1, 2)
  assert.ok(macro('PewPewWriteLogFunction PREFIX').includes('FlushFileBuffers'))
  inOrder(
    macro('PewPewFlushFile FILE'),
    [
      '${If} $0 P= -1',
      'FlushFileBuffers(p r0) i.r2 ?e',
      'CloseHandle(p r0)',
      '${If} $2 = 0',
    ],
    'Open and flush failures are both recorded',
  )
  inOrder(
    macro('PewPewCheckFlush RETRY'),
    ['MB_RETRYCANCEL', 'SetErrorLevel 2', 'Abort', 'files written to disk'],
    'A flush failure stops setup before "written to disk" is logged',
  )
  assert.ok(
    !template.includes('RegFlushKey'),
    'No synchronous registry flush while the freeze is investigated',
  )
  assert.ok(template.includes('MB_RETRYCANCEL'))
  assert.ok(template.includes('i 0x40000000, i 7, p 0, i 3'))
  console.log(
    'PASS: setup order, no forced client exit, minimal process rights, checked flushes, no registry flush',
  )

  const plainOut = path.join(work, 'plain.txt')
  const samples = [
    '"C:\\A B\\svc.exe"',
    '\\\\?\\C:\\A B\\svc.exe',
    '"\\\\?\\C:\\A B\\svc.exe"',
    'C:\\A B\\svc.exe',
    '"C:\\A B\\svc.exe" --other',
  ]
  const plain = await build(`  FileOpen $9 "${escape(plainOut)}" w
  FileWriteUTF16LE /BOM $9 ""
${samples
  .map(
    (sample) => `  StrCpy $R9 "${escape(sample)}"
  !insertmacro PewPewPlainPath $R9
  FileWriteUTF16LE $9 "$R9$\\n"`,
  )
  .join('\n')}
  FileClose $9`)
  assert.equal(await run(plain), 0)
  assert.deepEqual(
    (await readFile(plainOut))
      .subarray(2)
      .toString('utf16le')
      .split('\n')
      .slice(0, -1),
    [
      'C:\\A B\\svc.exe',
      'C:\\A B\\svc.exe',
      'C:\\A B\\svc.exe',
      'C:\\A B\\svc.exe',
      'C:\\A B\\svc.exe" --other',
    ],
  )
  console.log(
    'PASS: quoted and \\\\?\\ service registrations of this installation are recognised',
  )

  assert.equal(await harness('stop'), 0, 'A new installation must pass')
  console.log('PASS: missing files do not block a fresh install')

  const written = ['written-a.bin', 'written-b.bin'].map((name) =>
    path.join(work, name),
  )
  for (const file of written) await writeFile(file, 'payload')
  assert.equal(await flushHarness(written), 0, 'Writable files are flushed')
  assert.match(await readLog(), /setup test: files written to disk\r\n$/)
  assert.equal(
    await flushHarness([written[0], path.join(work, 'missing.bin')]),
    2,
    'A missing file stops setup',
  )
  let flushLog = await readLog()
  assert.match(
    flushLog,
    /files could not be written to disk: [^\r\n]*missing\.bin \(open error 2\); \r\n/,
  )
  assert.match(
    flushLog,
    /cancelled because files could not be written to disk\r\n$/,
    'Nothing is reported as written after a failure',
  )
  const readOnly = path.join(work, 'read-only.bin')
  await writeFile(readOnly, 'payload')
  await chmod(readOnly, 0o444)
  assert.equal(
    await flushHarness([readOnly]),
    2,
    'A file that cannot be opened for writing stops setup',
  )
  await chmod(readOnly, 0o666)
  flushLog = await readLog()
  assert.match(flushLog, /read-only\.bin \(open error 5\); \r\n/)
  assert.match(
    flushLog,
    /cancelled because files could not be written to disk\r\n$/,
  )
  console.log(
    'PASS: files that cannot be written to disk stop setup and are logged, never reported as written',
  )

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
  assert.equal(await harness('none'), 0, 'Closed files must remain writable')
  assert.deepEqual(await readFile(path.join(own, executableNames[0])), before)
  console.log('PASS: preflight never truncates an existing executable')

  const cores64 = []
  for (const name of executableNames)
    cores64.push(await start(path.join(own, name), []))
  const unrelated = await start(path.join(own, 'unrelated.exe'), [])
  const foreign = await start(path.join(other, executableNames[0]), [])
  assert.equal(
    await harness('none'),
    42,
    'A running core must reproduce the write lock',
  )
  assert.equal(
    await harness('count'),
    12,
    'Both owned cores are found, the foreign one is not',
  )
  assert.ok(
    cores64.every((child) => child.exitCode === null),
    'Counting must not stop cores',
  )
  assert.equal(
    await harness('stop'),
    0,
    'Owned cores must be released before copying',
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(
    cores64.every((child) => child.exitCode !== null),
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
  const coreLog = await readLog()
  for (const name of executableNames) {
    assert.match(
      coreLog,
      new RegExp(
        `\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} setup test: stopping leftover core pid \\d+: .*\\\\${name.replace('.', '\\.')}\\r\\n`,
      ),
    )
  }
  assert.match(coreLog, /core pid \d+ exited/)
  console.log(
    'PASS: locked stable/alpha cores are released and logged; unrelated processes survive',
  )

  const locker = await start(fixtureExe, [path.join(own, executableNames[0])])
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(locker.exitCode, null, 'File-lock fixture must be running')
  assert.equal(
    await harness('stop'),
    42,
    'An external file lock must block replacement',
  )
  assert.equal(
    locker.exitCode,
    null,
    'Do not terminate an unrelated file-lock owner',
  )
  assert.equal(
    await flushHarness([path.join(own, executableNames[0])]),
    2,
    'A file held open by another process stops setup at the flush',
  )
  assert.match(
    await readLog(),
    /verge-mihomo\.exe \(open error 32\); \r\n[\s\S]*cancelled because files could not be written to disk\r\n$/,
  )
  await stop(locker)
  assert.equal(
    await flushHarness([path.join(own, executableNames[0])]),
    0,
    'The flush passes once the lock is released',
  )
  assert.equal(
    await harness('stop'),
    0,
    'Retry must pass after the external lock is released',
  )
  assert.deepEqual(await readFile(path.join(own, executableNames[0])), before)
  console.log(
    'PASS: external locks block copying and flushing without data loss; retry succeeds after release',
  )

  const waitForClient = await build(`  StrCpy $0 "preserved-register"
  Call PewPewWaitForClientExit
  Pop $1
  \${If} $0 != "preserved-register"
    SetErrorLevel 43
  \${Else}
    SetErrorLevel $1
  \${EndIf}`)
  assert.equal(
    await run(waitForClient),
    0,
    'No client: setup goes on immediately',
  )
  const clientExe = path.join(own, `${clientName}.exe`)
  await copyFile(fixtureExe, clientExe)
  const client = await start(clientExe, [])
  const waitedFrom = Date.now()
  assert.equal(
    await run(waitForClient),
    1,
    'A running client blocks unattended setup',
  )
  const waited = Date.now() - waitedFrom
  assert.ok(
    waited >= 19000 && waited < 40000,
    `Bounded wait, took ${waited} ms`,
  )
  assert.equal(client.exitCode, null, 'Setup must not terminate the client')
  setTimeout(() => void stop(client), 2000)
  const exitedFrom = Date.now()
  assert.equal(
    await run(waitForClient),
    0,
    'A client that exits during the wait lets setup go on',
  )
  assert.ok(Date.now() - exitedFrom < 15000)
  assert.match(
    await readLog(),
    /client is running \(1 processes\); waiting for it to exit\r\n[\s\S]*client has exited\r\n/,
  )
  console.log(
    'PASS: a running client is waited for (bounded) and never terminated',
  )
} finally {
  for (const child of children) await stop(child)
}
