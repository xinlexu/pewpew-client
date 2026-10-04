import dayjs, { type Dayjs } from 'dayjs'

export type PewPewRouteSelection = {
  groupName: string
  proxyName: string
  previousProxy?: string
}

type ProfileExtra = {
  upload?: number
  download?: number
  total?: number
  expire?: number
}

export type PewPewProfileLike = {
  extra?: ProfileExtra
}

export type PewPewSubscriptionStatus = {
  remainingTraffic: string
  nextReset: string
  expire: string
}

export type PewPewAccountState =
  | 'unknown'
  | 'normal'
  | 'lifetime'
  | 'expiringSoon'
  | 'expired'
  | 'dataLow'
  | 'dataExhausted'

export type PewPewAccountEvaluation = {
  state: PewPewAccountState
  expired: boolean
  expiringSoon: boolean
  dataLow: boolean
  dataExhausted: boolean
  blocked: boolean
  blockReason: 'expired' | 'dataExhausted' | null
}

export type PewPewProxyOption = {
  name: string
  record: IProxyItem
  selectionPath?: PewPewRouteSelection[]
}

export type PewPewProxyGroupResult = {
  group: IProxyGroupItem | null
  options: PewPewProxyOption[]
  filteredInfoCount: number
  currentName: string
}

export const PEWPEW_UNKNOWN_STATUS = '未提供'
export const PEWPEW_LAST_YAML_PROFILE_KEY = 'pewpew-last-yaml-profile-uid'

const POLICY_TYPES = new Set([
  'selector',
  'urltest',
  'fallback',
  'loadbalance',
  'relay',
])

const BLOCKED_EXACT_NAMES = new Set([
  'DIRECT',
  'REJECT',
  'GLOBAL',
  'AUTO',
  'URLTEST',
  'FALLBACK',
  'LOADBALANCE',
  'SELECTOR',
])

const BLOCKED_NAME_KEYWORDS = [
  '剩余流量',
  '流量剩余',
  '可用流量',
  '已用流量',
  '总流量',
  '距离下次重置',
  '距离下次重置剩余',
  '下次重置',
  '重置时间',
  '重置',
  '套餐到期',
  '到期时间',
  '到期',
  '过期时间',
  '过期',
  '长期有效',
  '有效期',
  '续费',
  '购买',
  '网址',
  '网址导航',
  '官网',
  '官方网站',
  '导航',
  '用户群',
  '入口',
  '客服',
  '微信',
  'qq',
  'telegram',
  '电报',
  '群组',
  '频道',
  '公告',
  '通知',
  '教程',
  '使用教程',
  '使用说明',
  '说明',
  '订阅',
  '链接',
  '备用地址',
  '下载',
  '更新',
  '自动选择',
  '故障转移',
  '手动选择',
  '手动选择节点',
  '手动切换',
  '负载均衡',
  '隐私防护',
  '应用净化',
  '漏网之鱼',
  '广告',
  'ssone',
  'traffic',
  'remaining',
  'data',
  'data remaining',
  'remaining data',
  'reset',
  'expire',
  'expires',
  'expiration',
  'lifetime',
  'renew',
  'purchase',
  'official',
  'website',
  'navigation',
  'nav',
  'portal',
  'support',
  'customer service',
  'channel',
  'group',
  'announcement',
  'notice',
  'tutorial',
  'guide',
  'subscription',
  'link',
  'backup',
  'download',
  'update',
  'auto',
  'fallback',
  'load balance',
  'selector',
  'adblock',
]

const URL_OR_DOMAIN_PATTERN =
  /(https?:\/\/|www\.|t\.me|telegram\.(?:me|dog)|bit\.ly|tinyurl|shorturl|\.(?:com|net|org|io|cc|xyz|top|app|cloud)(?:\b|\/))/i

const GROUP_PRIORITY: Array<{
  score: number
  match: (name: string) => boolean
}> = [
  { score: 110, match: (name) => name === '手动切换' },
  { score: 106, match: (name) => name.includes('手动切换') },
  { score: 100, match: (name) => name === '手动选择节点' },
  { score: 96, match: (name) => name.includes('手动选择') },
  { score: 94, match: (name) => name.includes('节点选择') },
  { score: 93, match: (name) => name.includes('PewPew') },
  { score: 92.5, match: (name) => name.includes('EdNovas') },
  { score: 92, match: (name) => name.includes('选择') },
  { score: 90, match: (name) => name.toLowerCase() === 'proxy' },
  { score: 86, match: (name) => name === 'GLOBAL' },
  { score: 82, match: (name) => name.toLowerCase().includes('select') },
]

const MAIN_GROUP_BLOCKED_KEYWORDS = [
  '自动选择',
  '故障转移',
  '负载均衡',
  'netflix',
  'youtube',
  'telegram',
  'chatgpt',
  'adblock',
  '隐私防护',
  '应用净化',
  '漏网之鱼',
  'direct',
  'reject',
]

const getProxyName = (item?: string | IProxyItem | null) => {
  if (!item) return ''
  return typeof item === 'string' ? item.trim() : item.name?.trim() || ''
}

const normalizeType = (type?: string) =>
  type
    ?.trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '') || ''

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : []

export const isInformationalNode = (name?: string | null) => {
  const value = (name || '').trim()
  if (!value) return false

  const upperValue = value.toUpperCase().replace(/[\s_-]/g, '')
  if (BLOCKED_EXACT_NAMES.has(upperValue)) return true
  if (URL_OR_DOMAIN_PATTERN.test(value)) return true

  const lowerValue = value.toLowerCase()
  return BLOCKED_NAME_KEYWORDS.some((keyword) =>
    lowerValue.includes(keyword.toLowerCase()),
  )
}

export const isPewPewSubscriptionInfoName = isInformationalNode

export const isRealRoute = (
  name?: string | null,
  record?: Partial<IProxyItem> | null,
) => {
  const value = (name || '').trim()
  if (!value) return false
  if (isInformationalNode(value)) return false
  if (record?.hidden) return false
  if (Array.isArray(record?.all) && record.all.length > 0) return false
  if (POLICY_TYPES.has(normalizeType(record?.type))) return false
  return true
}

export const isPewPewDisplayableProxy = isRealRoute

export const filterDisplayRoutes = (
  names: Array<string | undefined | null>,
  records: Record<string, IProxyItem> = {},
) => {
  const seen = new Set<string>()
  return names.reduce<PewPewProxyOption[]>((acc, rawName) => {
    const name = (rawName || '').trim()
    if (!name || seen.has(name)) return acc
    seen.add(name)

    const record = records[name] || ({ name } as IProxyItem)
    if (isRealRoute(name, record)) {
      acc.push({ name, record })
    }
    return acc
  }, [])
}

const groupOptions = (
  group: IProxyGroupItem | IProxyItem | null | undefined,
  records: Record<string, IProxyItem>,
  groupMap: Map<string, IProxyGroupItem> = new Map(),
): PewPewProxyOption[] => {
  if (!group?.all?.length) return []
  const options: PewPewProxyOption[] = []
  const seenRoutes = new Set<string>()
  const visit = (
    parent: IProxyGroupItem | IProxyItem,
    path: PewPewRouteSelection[],
    seenGroups: Set<string>,
  ) => {
    if (normalizeType(parent.type) !== 'selector') return
    for (const item of parent.all || []) {
      const name = getProxyName(item)
      if (!name) continue
      const record =
        records[name] || (typeof item === 'object' ? item : undefined)
      const nestedGroup =
        groupMap.get(name) ||
        (Array.isArray(record?.all) && record.all.length > 0
          ? (record as unknown as IProxyGroupItem)
          : null)

      const selectionPath = [
        ...path,
        { groupName: parent.name, proxyName: name, previousProxy: parent.now },
      ]
      if (nestedGroup && !seenGroups.has(name)) {
        const nextSeen = new Set(seenGroups)
        nextSeen.add(name)
        visit(nestedGroup, selectionPath, nextSeen)
      } else if (
        !nestedGroup &&
        !seenRoutes.has(name) &&
        isRealRoute(name, record)
      ) {
        seenRoutes.add(name)
        options.push({
          name,
          record: record || ({ name } as IProxyItem),
          selectionPath,
        })
      }
    }
  }
  visit(group, [], new Set([group.name]))
  return options
}

const collectGroups = (proxies: any): IProxyGroupItem[] => {
  const records = (proxies?.records || {}) as Record<string, IProxyItem>
  const map = new Map<string, IProxyGroupItem>()

  const add = (group?: IProxyGroupItem | IProxyItem | null) => {
    if (!group?.name || !Array.isArray(group.all) || group.all.length === 0) {
      return
    }
    if (!map.has(group.name)) {
      map.set(group.name, group as IProxyGroupItem)
    }
  }

  ;(proxies?.groups || []).forEach(add)
  add(proxies?.global)
  Object.values(records).forEach(add)

  return Array.from(map.values())
}

const isBlockedMainGroup = (group: IProxyGroupItem) => {
  const lowerName = (group.name || '').toLowerCase()
  const normalizedType = normalizeType(group.type)
  if (normalizedType === 'urltest' || normalizedType === 'fallback') {
    return true
  }
  if (normalizedType === 'loadbalance') return true
  return MAIN_GROUP_BLOCKED_KEYWORDS.some((keyword) =>
    lowerName.includes(keyword.toLowerCase()),
  )
}

const groupScore = (
  group: IProxyGroupItem,
  index: number,
  optionsCount: number,
) => {
  if (isBlockedMainGroup(group)) return -1000 - index

  const name = group.name || ''
  const priority = GROUP_PRIORITY.find((item) => item.match(name))
  const selectableBoost = normalizeType(group.type) === 'selector' ? 10 : 0
  const routeBoost = Math.min(optionsCount, 60) / 10
  return (priority?.score ?? 40) + selectableBoost + routeBoost - index / 100
}

const collectProxyNames = (proxies: any) => {
  const names = new Set<string>()
  const records = (proxies?.records || {}) as Record<string, IProxyItem>

  Object.keys(records).forEach((name) => names.add(name))
  collectGroups(proxies).forEach((group) => {
    names.add(group.name)
    group.all?.forEach((item) => {
      const name = getProxyName(item)
      if (name) names.add(name)
    })
  })

  return Array.from(names)
}

export const resolvePewPewProxyGroup = (
  proxies: any,
  mode = 'rule',
): PewPewProxyGroupResult => {
  const records = (proxies?.records || {}) as Record<string, IProxyItem>
  const allNames = collectProxyNames(proxies)
  const filteredInfoCount = allNames.filter(isInformationalNode).length
  const groupMap = new Map(
    collectGroups(proxies).map((group) => [group.name, group] as const),
  )
  const selectableGroups = collectGroups(proxies).filter(
    (group) => normalizeType(group.type) === 'selector',
  )
  const candidates =
    mode.toLowerCase() === 'global'
      ? selectableGroups.filter((group) => group.name === 'GLOBAL')
      : selectableGroups.filter((group) => group.name !== 'GLOBAL')
  const groups = candidates
    .map((group, index) => ({
      group,
      options: groupOptions(group, records, groupMap),
      score: 0,
      index,
    }))
    .map((item) => ({
      ...item,
      score: groupScore(item.group, item.index, item.options.length),
    }))
    .filter((item) => item.options.length > 0)
    .sort((a, b) => b.score - a.score)

  const best = groups[0]
  let currentName = best?.group.now || ''
  const visited = new Set<string>()
  while (
    currentName &&
    groupMap.has(currentName) &&
    !visited.has(currentName)
  ) {
    visited.add(currentName)
    currentName = groupMap.get(currentName)?.now || ''
  }
  return best
    ? {
        group: best.group,
        options: best.options,
        filteredInfoCount,
        currentName,
      }
    : { group: null, options: [], filteredInfoCount, currentName: '' }
}

const formatBytes = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return PEWPEW_UNKNOWN_STATUS
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let amount = value
  let unitIndex = 0

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }

  const formatted = amount >= 100 ? amount.toFixed(0) : amount.toFixed(2)
  return `${formatted.replace(/\.00$/, '')} ${units[unitIndex]}`
}

const cleanStatusValue = (value?: string) =>
  value
    ?.replace(/^[\s:：-]+/, '')
    .replace(/\s*[|｜].*$/, '')
    .trim() || undefined

export const parseSubscriptionMetaFromText = (
  text: string,
  current: Partial<PewPewSubscriptionStatus> = {},
) => {
  const remaining = text.match(
    /(?:剩余流量|流量剩余|可用流量|remaining traffic|data remaining|remaining data)(?:\s*[:：-]\s*|\s+)(.+)/i,
  )
  if (remaining?.[1]) {
    current.remainingTraffic ||= cleanStatusValue(remaining[1])
  }

  const nextReset = text.match(
    /(?:距离下次重置剩余|距离下次重置|下次重置|重置时间|reset in|next reset|reset time)(?:\s*[:：-]\s*|\s+)(.+)/i,
  )
  if (nextReset?.[1]) {
    current.nextReset ||= cleanStatusValue(nextReset[1])
  }

  const expire = text.match(
    /(?:套餐到期|到期时间|过期时间|有效期|expires|expire date|expiration|valid until)(?:\s*[:：-]\s*|\s+)(.+)/i,
  )
  if (expire?.[1]) {
    current.expire ||= cleanStatusValue(expire[1])
  }

  if (
    !current.expire &&
    /(?:长期有效|lifetime|unlimited)/i.test(text) &&
    /(?:套餐到期|到期|过期|有效期|expires|expiration|valid|lifetime|unlimited)/i.test(
      text,
    )
  ) {
    current.expire = /长期有效/.test(text) ? '长期有效' : 'Lifetime'
  }

  return current
}

const collectConfigTextCandidates = (config: unknown) => {
  const root = asRecord(config)
  if (!root) return []

  const candidates: string[] = []
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      candidates.push(value.trim())
    }
  }

  asArray(root.proxies).forEach((item) => {
    if (typeof item === 'string') {
      add(item)
      return
    }
    add(asRecord(item)?.name)
  })

  asArray(root['proxy-groups'] || root.proxyGroups).forEach((item) => {
    const group = asRecord(item)
    if (!group) return
    add(group.name)
    asArray(group.proxies).forEach(add)
  })

  Object.entries(
    asRecord(root['proxy-providers'] || root.proxyProviders) || {},
  ).forEach(([key, value]) => {
    add(key)
    const provider = asRecord(value)
    add(provider?.name)
    asArray(provider?.proxies).forEach((item) => {
      add(asRecord(item)?.name)
    })
  })

  Object.entries(root).forEach(([key, value]) => {
    if (typeof value !== 'string') return
    if (
      /(?:server|uuid|password|token|url|path|port|secret|cipher|sni|host)/i.test(
        key,
      )
    ) {
      return
    }
    if (
      /(?:traffic|remaining|reset|expire|expiration|valid|lifetime|流量|重置|到期|过期|有效)/i.test(
        `${key} ${value}`,
      )
    ) {
      add(value)
    }
  })

  return candidates
}

export const extractSubscriptionMetaFromConfig = (
  config: unknown,
): PewPewSubscriptionStatus => {
  const status: Partial<PewPewSubscriptionStatus> = {}
  collectConfigTextCandidates(config).forEach((text) =>
    parseSubscriptionMetaFromText(text, status),
  )

  return {
    remainingTraffic: status.remainingTraffic || PEWPEW_UNKNOWN_STATUS,
    nextReset: status.nextReset || PEWPEW_UNKNOWN_STATUS,
    expire: status.expire || PEWPEW_UNKNOWN_STATUS,
  }
}

export const countDisplayRoutesFromConfig = (config: unknown) => {
  const root = asRecord(config)
  if (!root) return { routeCount: 0, infoCount: 0 }

  const records: Record<string, IProxyItem> = {}
  const names: string[] = []

  asArray(root.proxies).forEach((item) => {
    const proxy = asRecord(item)
    if (!proxy?.name || typeof proxy.name !== 'string') return
    records[proxy.name] = {
      ...(proxy as Partial<IProxyItem>),
      name: proxy.name,
    } as IProxyItem
    names.push(proxy.name)
  })

  asArray(root['proxy-groups'] || root.proxyGroups).forEach((item) => {
    const group = asRecord(item)
    if (!group) return
    asArray(group.proxies).forEach((name) => {
      if (typeof name === 'string') names.push(name)
    })
  })

  const uniqueNames = Array.from(new Set(names.map((name) => name.trim())))
  return {
    routeCount: filterDisplayRoutes(uniqueNames, records).length,
    infoCount: uniqueNames.filter(isInformationalNode).length,
  }
}

export const parseTrafficText = (value?: string | null) => {
  if (!value || value === PEWPEW_UNKNOWN_STATUS) return null

  const match = value
    .replace(/,/g, '')
    .match(/(-?\d+(?:\.\d+)?)\s*(PB|TB|GB|MB|KB|B)/i)
  if (!match) return null

  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null

  const unit = match[2].toUpperCase()
  const unitToGb: Record<string, number> = {
    B: 1 / 1024 / 1024 / 1024,
    KB: 1 / 1024 / 1024,
    MB: 1 / 1024,
    GB: 1,
    TB: 1024,
    PB: 1024 * 1024,
  }

  return amount * unitToGb[unit]
}

export const parseExpiryDate = (value?: string | null): Dayjs | null => {
  if (!value || value === PEWPEW_UNKNOWN_STATUS) return null
  if (/(?:长期有效|lifetime|unlimited)/i.test(value)) return null

  const match = value.match(/\b(20\d{2}-\d{1,2}-\d{1,2})\b/)
  const parsed = dayjs(match?.[1] || value)
  return parsed.isValid() ? parsed : null
}

export const evaluatePewPewAccountState = (
  status: PewPewSubscriptionStatus,
): PewPewAccountEvaluation => {
  const expireDate = parseExpiryDate(status.expire)
  const trafficGb = parseTrafficText(status.remainingTraffic)
  const today = dayjs().startOf('day')
  const lifetime = /(?:长期有效|lifetime|unlimited)/i.test(status.expire)
  const hasAnyStatus = Object.values(status).some(
    (value) => value !== PEWPEW_UNKNOWN_STATUS,
  )

  const expired = !!expireDate && expireDate.endOf('day').isBefore(today)
  const expiringSoon =
    !!expireDate &&
    !expired &&
    expireDate.startOf('day').diff(today, 'day') <= 7
  const dataExhausted = trafficGb !== null && trafficGb <= 0
  const dataLow = trafficGb !== null && trafficGb > 0 && trafficGb < 2

  const state: PewPewAccountState = expired
    ? 'expired'
    : dataExhausted
      ? 'dataExhausted'
      : expiringSoon
        ? 'expiringSoon'
        : dataLow
          ? 'dataLow'
          : lifetime
            ? 'lifetime'
            : hasAnyStatus
              ? 'normal'
              : 'unknown'

  return {
    state,
    expired,
    expiringSoon,
    dataLow,
    dataExhausted,
    blocked: expired || dataExhausted,
    blockReason: expired ? 'expired' : dataExhausted ? 'dataExhausted' : null,
  }
}

export const extractPewPewSubscriptionStatus = (
  profile?: PewPewProfileLike | null,
  proxies?: any,
  config?: unknown,
): PewPewSubscriptionStatus => {
  const status: Partial<PewPewSubscriptionStatus> = {}
  const extra = profile?.extra

  if (extra) {
    const upload = extra.upload ?? 0
    const download = extra.download ?? 0
    const total = extra.total ?? 0

    if (total > 0) {
      status.remainingTraffic = formatBytes(
        Math.max(total - upload - download, 0),
      )
    }

    if (extra.expire && extra.expire > 0) {
      status.expire = dayjs(extra.expire * 1000).format('YYYY-MM-DD')
    }
  }

  if (config) {
    collectConfigTextCandidates(config).forEach((text) =>
      parseSubscriptionMetaFromText(text, status),
    )
  }

  collectProxyNames(proxies).forEach((name) =>
    parseSubscriptionMetaFromText(name, status),
  )

  return {
    remainingTraffic: status.remainingTraffic || PEWPEW_UNKNOWN_STATUS,
    nextReset: status.nextReset || PEWPEW_UNKNOWN_STATUS,
    expire: status.expire || PEWPEW_UNKNOWN_STATUS,
  }
}
