import type { PewPewProxyOption } from './pewpew-client'

// mihomo reports 0 for a timeout; the client stores 1e6 for errors and
// 10000+ when a test ran out of time.
export const isUsableDelay = (
  delay: number | null | undefined,
): delay is number =>
  typeof delay === 'number' &&
  Number.isFinite(delay) &&
  delay > 0 &&
  delay < 10000

export type FastestRoute = { option: PewPewProxyOption; delay: number }

// The route that answered fastest, skipping `exclude` (the route that failed).
export const pickFastestRoute = (
  options: PewPewProxyOption[],
  delayOf: (option: PewPewProxyOption) => number | null | undefined,
  exclude?: string,
): FastestRoute | null => {
  let best: FastestRoute | null = null
  for (const option of options) {
    if (option.name === exclude || !option.selectionPath?.length) continue
    const delay = delayOf(option)
    if (isUsableDelay(delay) && (!best || delay < best.delay)) {
      best = { option, delay }
    }
  }
  return best
}

type GroupRecord = {
  type?: string
  now?: string
  all?: unknown[]
}

// True when the selection behind `groupName` runs through an automatic group
// (url-test, fallback, load-balance). Those groups switch nodes on their own,
// so the client must not override them.
export const selectionUsesAutoGroup = (
  records: Record<string, GroupRecord | undefined>,
  groupName: string,
) => {
  const visited = new Set<string>()
  let name = records[groupName]?.now
  while (name && !visited.has(name)) {
    visited.add(name)
    const record = records[name]
    if (!record || !Array.isArray(record.all)) return false
    if ((record.type || '').toLowerCase() !== 'selector') return true
    name = record.now
  }
  return false
}

// Regions, for grouping long route lists. Flags come first; the names cover
// subscriptions that write the place instead.
const REGION_PATTERNS: Array<[string, RegExp]> = [
  ['HK', /香港|Hong\s?Kong|(^|[^A-Z])HK([^A-Z]|$)/i],
  ['TW', /台湾|台灣|台北|Taiwan|(^|[^A-Z])TW([^A-Z]|$)/i],
  ['JP', /日本|东京|東京|大阪|Japan|Tokyo|Osaka|(^|[^A-Z])JP([^A-Z]|$)/i],
  ['SG', /新加坡|狮城|獅城|Singapore|(^|[^A-Z])SG([^A-Z]|$)/i],
  ['KR', /韩国|韓國|首尔|首爾|Korea|Seoul|(^|[^A-Z])KR([^A-Z]|$)/i],
  [
    'US',
    /美国|美國|洛杉矶|圣何塞|西雅图|纽约|硅谷|United\s?States|America|Los\s?Angeles|San\s?Jose|Seattle|(^|[^A-Z])USA?([^A-Z]|$)/i,
  ],
  ['GB', /英国|英國|伦敦|United\s?Kingdom|London|(^|[^A-Z])UK([^A-Z]|$)/i],
  ['DE', /德国|德國|法兰克福|Germany|Frankfurt/i],
  ['FR', /法国|法國|巴黎|France|Paris/i],
  ['NL', /荷兰|荷蘭|阿姆斯特丹|Netherlands|Amsterdam/i],
  ['CA', /加拿大|Canada/i],
  ['AU', /澳大利亚|澳洲|悉尼|Australia|Sydney/i],
  ['RU', /俄罗斯|俄羅斯|莫斯科|Russia|Moscow/i],
  ['IN', /印度(?!尼)|India/i],
  ['MY', /马来西亚|馬來西亞|Malaysia/i],
  ['TH', /泰国|泰國|Thailand/i],
  ['VN', /越南|Vietnam/i],
  ['PH', /菲律宾|菲律賓|Philippines/i],
  ['ID', /印尼|印度尼西亚|Indonesia/i],
  ['TR', /土耳其|Turkey|Türkiye/i],
  ['MO', /澳门|澳門|Macau|Macao/i],
]

const flagRegion = (name: string) => {
  const match = name.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)
  if (!match) return null
  const code = Array.from(match[0])
    .map((char) => String.fromCharCode(char.codePointAt(0)! - 0x1f1e6 + 65))
    .join('')
  // Some subscriptions mark Taiwan with the China flag; trust the name then.
  return code === 'CN' && /台湾|台灣|Taiwan/i.test(name) ? 'TW' : code
}

export const routeRegion = (name: string): string | null => {
  const flag = flagRegion(name)
  if (flag) return flag
  return REGION_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0] ?? null
}

export const regionFlag = (code: string) =>
  /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(
        ...Array.from(code).map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
      )
    : ''

const SHORT_REGION_NAMES: Record<string, [string, string]> = {
  HK: ['香港', 'Hong Kong'],
  TW: ['台湾', 'Taiwan'],
  MO: ['澳门', 'Macau'],
  KR: ['韩国', 'South Korea'],
  US: ['美国', 'United States'],
  GB: ['英国', 'United Kingdom'],
}

export const regionName = (code: string, language: string) => {
  const zh = language.toLowerCase().startsWith('zh')
  const short = SHORT_REGION_NAMES[code]
  if (short) return zh ? short[0] : short[1]
  try {
    return (
      new Intl.DisplayNames([zh ? 'zh-CN' : 'en'], { type: 'region' }).of(
        code,
      ) ?? code
    )
  } catch {
    return code
  }
}

export type RouteSort = 'default' | 'delay'

export type RouteSection = {
  // null collects routes without a recognizable region.
  region: string | null
  options: PewPewProxyOption[]
}

const delayRank = (delay: number | null | undefined) =>
  isUsableDelay(delay) ? delay : Number.MAX_SAFE_INTEGER

// Splits routes into region sections for long lists. Sections keep the
// subscription's order unless sorting by delay, which also orders the
// sections by their fastest route. Short lists, single-region lists and lists
// with about one route per region stay flat.
export const arrangeRoutes = (
  options: PewPewProxyOption[],
  sort: RouteSort,
  delayOf: (option: PewPewProxyOption) => number | null | undefined,
): RouteSection[] => {
  const ordered =
    sort === 'delay'
      ? options
          .map((option, index) => ({ option, index }))
          .sort(
            (a, b) =>
              delayRank(delayOf(a.option)) - delayRank(delayOf(b.option)) ||
              a.index - b.index,
          )
          .map((item) => item.option)
      : options

  const sections = new Map<string | null, PewPewProxyOption[]>()
  for (const option of ordered) {
    const region = routeRegion(option.name)
    const list = sections.get(region)
    if (list) list.push(option)
    else sections.set(region, [option])
  }

  const named = [...sections.keys()].filter((key) => key !== null)
  // Headers only help when regions hold several routes each.
  if (
    options.length < 6 ||
    named.length < 2 ||
    options.length < named.length * 2
  ) {
    return [{ region: null, options: ordered }]
  }
  const result = [...sections.entries()].map(([region, list]) => ({
    region,
    options: list,
  }))
  // Unrecognized routes go last.
  return [
    ...result.filter((section) => section.region !== null),
    ...result.filter((section) => section.region === null),
  ]
}
