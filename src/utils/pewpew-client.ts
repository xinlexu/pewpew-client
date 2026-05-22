import dayjs from 'dayjs'

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

export type PewPewProxyOption = {
  name: string
  record: IProxyItem
}

export type PewPewProxyGroupResult = {
  group: IProxyGroupItem | null
  options: PewPewProxyOption[]
}

const UNKNOWN_VALUE = '未提供'

const POLICY_TYPES = new Set(['Selector', 'URLTest', 'Fallback', 'LoadBalance'])

const BLOCKED_EXACT_NAMES = new Set(['DIRECT', 'REJECT', 'GLOBAL'])

const BLOCKED_NAME_KEYWORDS = [
  '剩余流量',
  '距离下次重置剩余',
  '重置',
  '套餐到期',
  '到期',
  '网址导航',
  '官网',
  '导航',
  '流量',
  '套餐',
  '自动选择',
  '手动选择',
  '手动选择节点',
  '负载均衡',
  'SSONE',
  '订阅',
]

const GROUP_PRIORITY: Array<{
  score: number
  match: (name: string) => boolean
}> = [
  { score: 100, match: (name) => name === '手动选择节点' },
  { score: 95, match: (name) => name.includes('手动选择') },
  { score: 90, match: (name) => name.toLowerCase() === 'proxy' },
  { score: 85, match: (name) => name === 'GLOBAL' },
  { score: 80, match: (name) => name.includes('节点选择') },
  { score: 75, match: (name) => name.toLowerCase().includes('select') },
]

const getProxyName = (item?: string | IProxyItem | null) => {
  if (!item) return ''
  return typeof item === 'string' ? item.trim() : item.name?.trim() || ''
}

const normalizeType = (type?: string) => type?.trim() || ''

export const isPewPewSubscriptionInfoName = (name?: string | null) => {
  const value = (name || '').trim()
  if (!value) return false
  const lowerValue = value.toLowerCase()
  return BLOCKED_NAME_KEYWORDS.some((keyword) =>
    lowerValue.includes(keyword.toLowerCase()),
  )
}

export const isPewPewDisplayableProxy = (
  name?: string | null,
  record?: Partial<IProxyItem> | null,
) => {
  const value = (name || '').trim()
  if (!value) return false
  if (BLOCKED_EXACT_NAMES.has(value.toUpperCase())) return false
  if (isPewPewSubscriptionInfoName(value)) return false
  if (record?.hidden) return false
  if (Array.isArray(record?.all) && record.all.length > 0) return false
  if (POLICY_TYPES.has(normalizeType(record?.type))) return false
  return true
}

const groupOptions = (
  group: IProxyGroupItem | IProxyItem | null | undefined,
  records: Record<string, IProxyItem>,
): PewPewProxyOption[] => {
  if (!group?.all?.length) return []

  const names = group.all.map(getProxyName).filter(Boolean)
  const uniqueNames = Array.from(new Set(names))

  return uniqueNames.reduce<PewPewProxyOption[]>((acc, name) => {
    const record = records[name] || ({ name } as IProxyItem)
    if (isPewPewDisplayableProxy(name, record)) {
      acc.push({ name, record })
    }
    return acc
  }, [])
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

const groupScore = (group: IProxyGroupItem, index: number) => {
  const name = group.name || ''
  const priority = GROUP_PRIORITY.find((item) => item.match(name))
  const selectableBoost = POLICY_TYPES.has(normalizeType(group.type)) ? 10 : 0
  return (priority?.score ?? 40) + selectableBoost - index / 100
}

export const resolvePewPewProxyGroup = (
  proxies: any,
): PewPewProxyGroupResult => {
  const records = (proxies?.records || {}) as Record<string, IProxyItem>
  const groups = collectGroups(proxies)
    .map((group, index) => ({
      group,
      options: groupOptions(group, records),
      score: groupScore(group, index),
    }))
    .filter((item) => item.options.length > 0)
    .sort((a, b) => b.score - a.score)

  const best = groups[0]
  return best
    ? { group: best.group, options: best.options }
    : { group: null, options: [] }
}

const formatBytes = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return UNKNOWN_VALUE
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
  value?.replace(/^[\s:：-]+/, '').trim() || undefined

const parseStatusFromName = (
  name: string,
  current: Partial<PewPewSubscriptionStatus>,
) => {
  const remaining = name.match(/剩余流量[:：]\s*(.+)/)
  if (remaining?.[1]) {
    current.remainingTraffic ||= cleanStatusValue(remaining[1])
  }

  const nextReset = name.match(/距离下次重置剩余[:：]\s*(.+)/)
  if (nextReset?.[1]) {
    current.nextReset ||= cleanStatusValue(nextReset[1])
  }

  const expire = name.match(/套餐到期[:：]\s*(.+)/)
  if (expire?.[1]) {
    current.expire ||= cleanStatusValue(expire[1])
  }
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

export const extractPewPewSubscriptionStatus = (
  profile?: PewPewProfileLike | null,
  proxies?: any,
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

  collectProxyNames(proxies).forEach((name) =>
    parseStatusFromName(name, status),
  )

  return {
    remainingTraffic: status.remainingTraffic || UNKNOWN_VALUE,
    nextReset: status.nextReset || UNKNOWN_VALUE,
    expire: status.expire || UNKNOWN_VALUE,
  }
}
