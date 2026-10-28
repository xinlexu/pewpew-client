#!/usr/bin/env node
// Writes latest.json for PewPew's in-app updater (see docs/updater.md).
//
// It refuses to write a manifest that installed clients could not verify: the
// installer's signature must match the public key in src-tauri/tauri.conf.json,
// and that key must be PewPew's own, not the one inherited from Clash Verge.
//
//   node scripts/pewpew-update-manifest.mjs \
//     --installer "target/.../PewPew_0.1.5_x64-setup.exe" \
//     --url "https://github.com/xinlexu/pewpew-client/releases/download/v0.1.5/PewPew_0.1.5_x64-setup.exe" \
//     --notes release-notes.md --out latest.json
import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Clash Verge Rev's updater key. PewPew inherited it but has no private key for it.
export const UPSTREAM_PUBKEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQyOEMyRjBCQkVGOUJEREYKUldUZnZmbStDeStNMHU5Mmo1N24xQXZwSVRYbXA2NUpzZE5oVzlqeS9Bc0t6RVV4MmtwVjBZaHgK'

const textLines = (base64Text) =>
  Buffer.from(base64Text.trim(), 'base64')
    .toString('utf8')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))

// minisign public key: "Ed" + 8-byte key id + 32-byte Ed25519 key.
export function parsePublicKey(pubkey) {
  const line = textLines(pubkey).filter(Boolean).at(-1) ?? ''
  const raw = Buffer.from(line, 'base64')
  if (raw.length !== 42 || raw.subarray(0, 2).toString('latin1') !== 'Ed') {
    throw new Error('not a minisign public key')
  }
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10) }
}

// minisign signature: untrusted comment, signature line, trusted comment,
// global signature over (signature + trusted comment).
export function parseSignature(signature) {
  const [, signatureLine = '', trustedLine = '', globalLine = ''] =
    textLines(signature)
  const raw = Buffer.from(signatureLine, 'base64')
  const algorithm = raw.subarray(0, 2).toString('latin1')
  if (raw.length !== 74 || (algorithm !== 'Ed' && algorithm !== 'ED')) {
    throw new Error('not a minisign signature')
  }
  const prefix = 'trusted comment: '
  if (!trustedLine.startsWith(prefix)) {
    throw new Error('signature has no trusted comment')
  }
  return {
    // "ED" signs the BLAKE2b-512 hash of the file, "Ed" the file itself.
    prehashed: algorithm === 'ED',
    keyId: raw.subarray(2, 10),
    signature: raw.subarray(10),
    trustedComment: trustedLine.slice(prefix.length),
    globalSignature: Buffer.from(globalLine, 'base64'),
  }
}

const ed25519Key = (raw) =>
  createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') },
    format: 'jwk',
  })

// Same check the updater runs before it installs a download.
export function verifyUpdateSignature(fileBytes, signature, pubkey) {
  const key = parsePublicKey(pubkey)
  const sig = parseSignature(signature)
  if (!sig.keyId.equals(key.keyId)) return { ok: false, reason: 'other-key' }
  const publicKey = ed25519Key(key.key)
  const message = sig.prehashed
    ? createHash('blake2b512').update(fileBytes).digest()
    : fileBytes
  if (!verify(null, message, publicKey, sig.signature)) {
    return { ok: false, reason: 'file-changed' }
  }
  const comment = Buffer.concat([
    sig.signature,
    Buffer.from(sig.trustedComment, 'utf8'),
  ])
  if (!verify(null, comment, publicKey, sig.globalSignature)) {
    return { ok: false, reason: 'comment-changed' }
  }
  return { ok: true }
}

export const buildManifest = ({ version, notes, url, signature, pubDate }) => ({
  version,
  notes,
  pub_date: pubDate,
  platforms: {
    'windows-x86_64': { signature: signature.trim(), url },
  },
})

const REASONS = {
  'other-key':
    '签名用的私钥和 tauri.conf.json 里的公钥不是一对。客户端会拒绝这个更新。',
  'file-changed': '安装包在签名后被改动过，或者签名对应的是另一个文件。',
  'comment-changed': '签名文件被改动过。',
}

const fail = (message) => {
  console.error(`✖ ${message}`)
  process.exit(1)
}

async function main() {
  const { values } = parseArgs({
    options: {
      installer: { type: 'string' },
      signature: { type: 'string' },
      url: { type: 'string' },
      notes: { type: 'string' },
      out: { type: 'string', default: 'latest.json' },
      config: {
        type: 'string',
        default: path.join(ROOT, 'src-tauri', 'tauri.conf.json'),
      },
    },
  })
  if (!values.installer || !values.url) {
    fail('需要 --installer <安装包路径> 和 --url <GitHub 下载地址>')
  }
  if (!values.url.startsWith('https://')) fail('--url 必须是 https 地址')

  const config = JSON.parse(await readFile(values.config, 'utf8'))
  const pubkey = config.plugins?.updater?.pubkey ?? ''
  if (!pubkey || pubkey === UPSTREAM_PUBKEY) {
    fail(
      'tauri.conf.json 里还是 Clash Verge 的更新公钥。请先按 docs/updater.md 生成 PewPew 自己的签名密钥，填入公钥后重新打包。',
    )
  }

  const installer = await readFile(values.installer)
  const signature = await readFile(
    values.signature ?? `${values.installer}.sig`,
    'utf8',
  )
  const result = verifyUpdateSignature(installer, signature, pubkey)
  if (!result.ok) fail(REASONS[result.reason])

  const urlName = decodeURIComponent(
    path.posix.basename(new URL(values.url).pathname),
  )
  if (urlName !== path.basename(values.installer)) {
    console.warn(
      `! 下载地址的文件名 (${urlName}) 和本地安装包 (${path.basename(values.installer)}) 不同，请确认上传的是同一个文件。`,
    )
  }

  const notes = values.notes
    ? (await readFile(values.notes, 'utf8')).trim()
    : ''
  const manifest = buildManifest({
    version: config.version,
    notes,
    url: values.url,
    signature,
    pubDate: new Date().toISOString(),
  })
  await writeFile(values.out, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`✔ ${values.out}: ${config.version}，签名已用客户端公钥验证`)
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main()
}
