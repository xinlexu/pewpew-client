import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const mode = process.argv[2]

const MODES = {
  x64: {
    expected: 'x86_64',
    dirs: [
      'target/x86_64-apple-darwin/release/bundle/macos',
      'target/release/bundle/macos',
    ],
  },
  arm64: {
    expected: 'arm64',
    dirs: ['target/aarch64-apple-darwin/release/bundle/macos'],
  },
}

if (!MODES[mode]) {
  console.error('Usage: node scripts/check-macos-arch.mjs <x64|arm64>')
  process.exit(2)
}

const { expected, dirs } = MODES[mode]

function findAppBundle() {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    const app = fs
      .readdirSync(dir)
      .find((entry) => entry.endsWith('.app'))
    if (app) return path.join(dir, app)
  }
  return null
}

const appBundle = findAppBundle()

if (!appBundle) {
  console.error(`No macOS .app bundle found for ${mode}. Checked:`)
  for (const dir of dirs) console.error(`- ${dir}`)
  process.exit(1)
}

const checks = [
  ['main app', 'Contents/MacOS/pewpew-client'],
  ['mihomo', 'Contents/MacOS/verge-mihomo'],
  ['mihomo alpha', 'Contents/MacOS/verge-mihomo-alpha'],
  ['service', 'Contents/Resources/resources/clash-verge-service'],
  [
    'service install',
    'Contents/Resources/resources/clash-verge-service-install',
  ],
  [
    'service uninstall',
    'Contents/Resources/resources/clash-verge-service-uninstall',
  ],
]

let failed = false

console.log(`Checking ${appBundle}`)
console.log(`Expected architecture: ${expected}`)

for (const [label, relativePath] of checks) {
  const filePath = path.join(appBundle, relativePath)

  if (!fs.existsSync(filePath)) {
    console.error(`Missing ${label}: ${relativePath}`)
    failed = true
    continue
  }

  const output = execFileSync('file', [filePath], {
    encoding: 'utf8',
  }).trim()

  console.log(`${label}: ${output}`)

  if (!output.includes(expected)) {
    console.error(`Architecture mismatch for ${label}; expected ${expected}`)
    failed = true
  }
}

if (failed) process.exit(1)

console.log(`All macOS binaries are ${expected}.`)
