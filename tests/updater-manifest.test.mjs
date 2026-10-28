import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  UPSTREAM_PUBKEY,
  buildManifest,
  verifyUpdateSignature,
} from '../scripts/pewpew-update-manifest.mjs'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const fixtures = path.join(root, 'tests', 'fixtures', 'updater')
const script = path.join(root, 'scripts', 'pewpew-update-manifest.mjs')
const installerPath = path.join(fixtures, 'fixture-installer.bin')
const signaturePath = path.join(fixtures, 'fixture-signature.txt')
const load = async () => ({
  installer: await readFile(installerPath),
  signature: await readFile(signaturePath, 'utf8'),
  pubkey: (
    await readFile(path.join(fixtures, 'fixture-key.pub'), 'utf8')
  ).trim(),
})

test('a signature from the matching key verifies', async () => {
  const { installer, signature, pubkey } = await load()
  assert.deepEqual(verifyUpdateSignature(installer, signature, pubkey), {
    ok: true,
  })
})

test('a changed installer, another key or an edited comment is rejected', async () => {
  const { installer, signature, pubkey } = await load()
  const changed = Buffer.from(installer)
  changed[100] ^= 0xff
  assert.equal(
    verifyUpdateSignature(changed, signature, pubkey).reason,
    'file-changed',
  )
  assert.equal(
    verifyUpdateSignature(installer, signature, UPSTREAM_PUBKEY).reason,
    'other-key',
  )
  const text = Buffer.from(signature.trim(), 'base64').toString('utf8')
  const edited = Buffer.from(
    text.replace('file:fixture-installer.bin', 'file:other.bin'),
  ).toString('base64')
  assert.equal(
    verifyUpdateSignature(installer, edited, pubkey).reason,
    'comment-changed',
  )
})

test('the manifest has the shape the updater reads', () => {
  assert.deepEqual(
    buildManifest({
      version: '0.1.5',
      notes: '- fix',
      url: 'https://example.invalid/setup.exe',
      signature: 'c2ln\n',
      pubDate: '2026-10-08T00:00:00.000Z',
    }),
    {
      version: '0.1.5',
      notes: '- fix',
      pub_date: '2026-10-08T00:00:00.000Z',
      platforms: {
        'windows-x86_64': {
          signature: 'c2ln',
          url: 'https://example.invalid/setup.exe',
        },
      },
    },
  )
})

test('the client checks PewPew’s own update channel', async () => {
  const config = JSON.parse(
    await readFile(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  )
  assert.deepEqual(config.plugins.updater.endpoints, [
    'https://github.com/xinlexu/pewpew-client/releases/download/updater/latest.json',
  ])
  assert.equal(config.plugins.updater.windows.installMode, 'passive')
})

test('the script writes a manifest only for a verifiable installer', async () => {
  const { pubkey } = await load()
  const dir = await mkdtemp(path.join(tmpdir(), 'pewpew-manifest-'))
  try {
    const config = (key) =>
      JSON.stringify({
        version: '0.1.5',
        plugins: { updater: { pubkey: key } },
      })
    const args = (configPath, out) => [
      script,
      '--installer',
      installerPath,
      '--signature',
      signaturePath,
      '--url',
      'https://github.com/xinlexu/pewpew-client/releases/download/v0.1.5/fixture-installer.bin',
      '--config',
      configPath,
      '--out',
      out,
    ]

    const upstream = path.join(dir, 'upstream.json')
    await writeFile(upstream, config(UPSTREAM_PUBKEY))
    await assert.rejects(
      run(process.execPath, args(upstream, path.join(dir, 'never.json'))),
      (error) =>
        error.code === 1 && /Clash Verge 的更新公钥/.test(error.stderr),
    )

    const own = path.join(dir, 'own.json')
    const out = path.join(dir, 'latest.json')
    await writeFile(own, config(pubkey))
    await run(process.execPath, args(own, out))
    const manifest = JSON.parse(await readFile(out, 'utf8'))
    assert.equal(manifest.version, '0.1.5')
    assert.equal(
      manifest.platforms['windows-x86_64'].signature,
      (await readFile(signaturePath, 'utf8')).trim(),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
