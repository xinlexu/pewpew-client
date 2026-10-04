import assert from 'node:assert/strict'
import test from 'node:test'
import { resolvePewPewProxyGroup } from '../src/utils/pewpew-client.ts'
import { applyRouteSelection } from '../src/utils/route-selection.ts'
import {
  isSubscriptionUrl,
  normalizeSubscriptionUrlInput,
} from '../src/utils/subscription-url.ts'
import {
  serviceCacheMatches,
  serviceReleaseFromMetadata,
} from '../scripts/service-bundle.mjs'

const selector = (name, all, now) => ({ name, type: 'Selector', all, now })
const route = (name) => ({ name, type: 'Shadowsocks' })
const model = (...items) => ({
  records: Object.fromEntries(items.map((item) => [item.name, item])),
})

test('nested routes retain the full selection path and current leaf', () => {
  const data = model(
    selector('Proxy', ['Region'], 'Region'),
    selector('Region', ['Paris', 'Tokyo'], 'Tokyo'),
    route('Paris'),
    route('Tokyo'),
  )
  const result = resolvePewPewProxyGroup(data)
  assert.equal(result.currentName, 'Tokyo')
  assert.deepEqual(result.options[0].selectionPath, [
    { groupName: 'Proxy', proxyName: 'Region', previousProxy: 'Region' },
    { groupName: 'Region', proxyName: 'Paris', previousProxy: 'Tokyo' },
  ])
})

test('global mode selects GLOBAL and rule mode does not', () => {
  const data = model(
    selector('Proxy', ['Tokyo'], 'Tokyo'),
    selector('GLOBAL', ['Paris'], 'Paris'),
    route('Paris'),
    route('Tokyo'),
  )
  assert.equal(resolvePewPewProxyGroup(data, 'global').group.name, 'GLOBAL')
  assert.equal(resolvePewPewProxyGroup(data, 'rule').group.name, 'Proxy')
})

test('arbitrarily named rule groups outrank the unrelated global selector', () => {
  const data = model(
    selector('My routes', ['Tokyo'], 'Tokyo'),
    selector('GLOBAL', ['Paris'], 'Paris'),
    route('Paris'),
    route('Tokyo'),
  )
  assert.equal(resolvePewPewProxyGroup(data).group.name, 'My routes')
})

test('cycles terminate and preserve valid routes', () => {
  const data = model(
    selector('Proxy', ['Region'], 'Region'),
    selector('Region', ['Proxy', 'Tokyo'], 'Proxy'),
    route('Tokyo'),
  )
  const result = resolvePewPewProxyGroup(data)
  assert.deepEqual(
    result.options.map((item) => item.name),
    ['Tokyo'],
  )
})

test('automatic groups are not exposed as manually selectable leaf routes', () => {
  const data = model(
    selector('Proxy', ['Auto', 'Tokyo'], 'Tokyo'),
    { name: 'Auto', type: 'URLTest', all: ['Paris'], now: 'Paris' },
    route('Paris'),
    route('Tokyo'),
  )
  assert.deepEqual(
    resolvePewPewProxyGroup(data).options.map((item) => item.name),
    ['Tokyo'],
  )
})

test('selection updates children before parents', async () => {
  const calls = []
  await applyRouteSelection(
    [
      { groupName: 'Proxy', proxyName: 'Region', previousProxy: 'Other' },
      { groupName: 'Region', proxyName: 'Tokyo', previousProxy: 'Paris' },
    ],
    async (...args) => calls.push(args),
  )
  assert.deepEqual(calls, [
    ['Region', 'Tokyo'],
    ['Proxy', 'Region'],
  ])
})

test('failed parent selection restores already changed children and rejects', async () => {
  const calls = []
  await assert.rejects(
    applyRouteSelection(
      [
        { groupName: 'Proxy', proxyName: 'Region', previousProxy: 'Other' },
        { groupName: 'Region', proxyName: 'Tokyo', previousProxy: 'Paris' },
      ],
      async (...args) => {
        calls.push(args)
        if (args[0] === 'Proxy') throw new Error('selection failed')
      },
    ),
    /selection failed/,
  )
  assert.deepEqual(calls, [
    ['Region', 'Tokyo'],
    ['Proxy', 'Region'],
    ['Region', 'Paris'],
  ])
})

test('pasted subscription links preserve escaped tokens', () => {
  assert.equal(
    normalizeSubscriptionUrlInput(
      '\uFEFF https://example.test/sub?token=a%2Bb&amp;flag=1。',
    ),
    'https://example.test/sub?token=a%2Bb&flag=1',
  )
})

for (const scheme of ['pewpew', 'clash', 'clash-verge']) {
  test(`${scheme} import links extract the URL without the display name`, () => {
    const url = 'https://example.test/sub?token=a%2Bb&flag=1'
    assert.equal(
      normalizeSubscriptionUrlInput(
        `${scheme}://install-config?url=${encodeURIComponent(url)}&name=Demo`,
      ),
      url,
    )
  })
}

test('invalid URLs are rejected before importing', () => {
  for (const url of [
    'https://',
    'https://?',
    'file:///tmp/test.yaml',
    'not a URL',
  ])
    assert.equal(isSubscriptionUrl(url), false)
  assert.equal(isSubscriptionUrl('https://example.test/sub'), true)
})

test('background service release follows the exact client dependency', () => {
  const metadata = {
    packages: [
      {
        name: 'pewpew-client',
        dependencies: [{ name: 'clash_verge_service_ipc', req: '=2.3.0' }],
      },
    ],
  }
  assert.equal(serviceReleaseFromMetadata(metadata), 'v2.3.0')
  metadata.packages[0].dependencies[0].req = '^2.3.0'
  assert.throws(() => serviceReleaseFromMetadata(metadata), /exact version/)
})

test('service cache rejects the other Mac architecture, wrong versions and missing files', () => {
  const cache = {
    target: 'aarch64-apple-darwin',
    version: 'v2.3.0',
    hashes: { service: 'abc' },
  }
  assert.equal(
    serviceCacheMatches(cache, 'aarch64-apple-darwin', 'v2.3.0', {
      service: 'abc',
    }),
    true,
  )
  assert.equal(
    serviceCacheMatches(cache, 'x86_64-apple-darwin', 'v2.3.0', {
      service: 'abc',
    }),
    false,
  )
  assert.equal(
    serviceCacheMatches(cache, cache.target, 'v2.7.6', { service: 'abc' }),
    false,
  )
  assert.equal(
    serviceCacheMatches(cache, cache.target, cache.version, { service: null }),
    false,
  )
  assert.equal(
    serviceCacheMatches(cache, cache.target, cache.version, {
      service: 'different',
    }),
    false,
  )
})
