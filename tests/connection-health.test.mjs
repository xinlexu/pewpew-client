import assert from 'node:assert/strict'
import test from 'node:test'

import { judgeConnection, timedStatus } from '../src/utils/connection-check.ts'
import {
  arrangeRoutes,
  isUsableDelay,
  pickFastestRoute,
  regionFlag,
  routeRegion,
  selectionUsesAutoGroup,
} from '../src/utils/route-health.ts'

const route = (name) => ({
  name,
  record: { name, type: 'Shadowsocks' },
  selectionPath: [{ groupName: 'Proxy', proxyName: name }],
})

const healthy = {
  connected: true,
  mode: 'standard',
  clashMode: 'rule',
  core: true,
  portOpen: true,
  systemProxy: true,
  tun: false,
  otherApps: [],
  route: '🇭🇰 香港 01',
  routeDelay: 86,
  domestic: 120,
  foreign: 640,
}

test('only answered, timely delays count as usable', () => {
  for (const value of [1, 86, 9999]) assert.ok(isUsableDelay(value))
  for (const value of [0, -1, -2, 10000, 1e6, Number.NaN, null, undefined])
    assert.ok(!isUsableDelay(value))
  assert.equal(timedStatus(null, 1500), 'unknown')
  assert.equal(timedStatus(10000, 1500), 'fail')
  assert.equal(timedStatus(2000, 1500), 'warn')
  assert.equal(timedStatus(300, 1500), 'ok')
})

test('the fastest answering route wins, never the failed or unselectable one', () => {
  const options = [
    route('A'),
    route('B'),
    route('C'),
    { name: 'D', record: {} },
  ]
  const delays = { A: 30, B: 210, C: 0, D: 5 }
  const best = pickFastestRoute(options, (o) => delays[o.name], 'A')
  assert.equal(best.option.name, 'B')
  assert.equal(best.delay, 210)
  assert.equal(
    pickFastestRoute(options, (o) => (o.name === 'A' ? 30 : 0), 'A'),
    null,
  )
})

test('automatic groups are left to switch nodes themselves', () => {
  const records = {
    Proxy: { type: 'Selector', all: ['Auto', 'HK'], now: 'Auto' },
    Auto: { type: 'URLTest', all: ['HK'], now: 'HK' },
    Nested: { type: 'Selector', all: ['Proxy'], now: 'Proxy' },
    Manual: { type: 'Selector', all: ['HK'], now: 'HK' },
    HK: { type: 'Shadowsocks' },
  }
  assert.ok(selectionUsesAutoGroup(records, 'Proxy'))
  assert.ok(selectionUsesAutoGroup(records, 'Nested'))
  assert.ok(!selectionUsesAutoGroup(records, 'Manual'))
})

test('regions come from flags first, then place names', () => {
  assert.equal(routeRegion('🇭🇰 香港 01'), 'HK')
  assert.equal(routeRegion('0.5X 🇺🇸 美国10 VLESS'), 'US')
  assert.equal(routeRegion('日本 东京 BGP 02'), 'JP')
  assert.equal(routeRegion('Singapore Premium'), 'SG')
  assert.equal(routeRegion('狮城 03'), 'SG')
  assert.equal(routeRegion('🇨🇳 台湾 01'), 'TW')
  assert.equal(routeRegion('印尼 01'), 'ID')
  assert.equal(routeRegion('Backup line'), null)
  // Letters inside words are not region codes.
  assert.equal(routeRegion('Shkodra Hub'), null)
  assert.equal(regionFlag('JP'), '🇯🇵')
})

test('long lists split by region; delay sort orders rows and sections', () => {
  const names = [
    '🇭🇰 香港 01',
    '🇯🇵 日本 01',
    '🇭🇰 香港 02',
    '🇺🇸 美国 01',
    '🇯🇵 日本 02',
    'Backup',
  ]
  const options = names.map(route)
  const delays = {
    '🇭🇰 香港 01': 300,
    '🇯🇵 日本 01': 90,
    '🇭🇰 香港 02': 120,
    '🇺🇸 美国 01': 0,
    '🇯🇵 日本 02': -1,
    Backup: 50,
  }
  const delayOf = (o) => delays[o.name]

  const byOrder = arrangeRoutes(options, 'default', delayOf)
  assert.deepEqual(
    byOrder.map((s) => [s.region, s.options.map((o) => o.name)]),
    [
      ['HK', ['🇭🇰 香港 01', '🇭🇰 香港 02']],
      ['JP', ['🇯🇵 日本 01', '🇯🇵 日本 02']],
      ['US', ['🇺🇸 美国 01']],
      [null, ['Backup']],
    ],
  )

  const byDelay = arrangeRoutes(options, 'delay', delayOf)
  assert.deepEqual(
    byDelay.map((s) => [s.region, s.options.map((o) => o.name)]),
    [
      ['JP', ['🇯🇵 日本 01', '🇯🇵 日本 02']],
      ['HK', ['🇭🇰 香港 02', '🇭🇰 香港 01']],
      ['US', ['🇺🇸 美国 01']],
      [null, ['Backup']],
    ],
  )

  // Short lists, and lists with about one route per region, stay flat.
  const short = arrangeRoutes(options.slice(0, 3), 'default', delayOf)
  assert.equal(short.length, 1)
  assert.equal(short[0].region, null)
  const spread = ['🇭🇰 A', '🇯🇵 B', '🇸🇬 C', '🇺🇸 D', '🇰🇷 E', '🇬🇧 F', '🇹🇼 G']
  const flat = arrangeRoutes(spread.map(route), 'delay', () => 50)
  assert.deepEqual(
    flat.map((s) => s.region),
    [null],
  )
})

test('the verdict names the first broken link and the fix', () => {
  const judge = (patch) => judgeConnection({ ...healthy, ...patch })
  assert.deepEqual(
    [judge({}).key, judge({}).tone, judge({}).action],
    ['ok', 'success', null],
  )
  assert.equal(judge({ core: false }).action, 'repair')
  assert.equal(judge({ connected: false }).key, 'disconnected')
  assert.equal(judge({ portOpen: false }).key, 'portBusy')
  assert.equal(judge({ mode: 'enhanced', tun: false }).key, 'enhancedMissing')
  assert.equal(judge({ systemProxy: false }).key, 'systemProxyOff')
  assert.equal(judge({ clashMode: 'direct' }).action, 'smartMode')

  const dead = judge({ routeDelay: 0, foreign: 10000 })
  assert.deepEqual([dead.key, dead.action], ['routeDown', 'fastestRoute'])
  assert.equal(dead.params.route, '🇭🇰 香港 01')
  assert.equal(judge({ foreign: 10000 }).key, 'foreignDown')
  assert.equal(
    judge({ foreign: 10000, otherApps: ['Clash Verge'] }).key,
    'foreignDownApps',
  )

  // The friend's case: slow sites in China while connected.
  const global = judge({ clashMode: 'global', domestic: 2600 })
  assert.deepEqual(
    [global.key, global.action],
    ['domesticSlowGlobal', 'smartMode'],
  )
  assert.equal(
    judge({ domestic: 2600, otherApps: ['Clash Verge'] }).key,
    'domesticSlowApps',
  )
  assert.equal(judge({ domestic: 2600 }).key, 'domesticSlow')
  assert.equal(judge({ domestic: 10000 }).key, 'domesticDown')

  assert.equal(judge({ otherApps: ['v2rayN'] }).key, 'otherApps')
  assert.equal(judge({ foreign: 3500 }).action, 'fastestRoute')
  assert.equal(judge({ clashMode: 'global' }).key, 'okGlobal')
  assert.equal(judge({ otherApps: null, domestic: null }).key, 'okPartial')
})
