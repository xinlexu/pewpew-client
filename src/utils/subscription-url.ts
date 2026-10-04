const INVISIBLE_TEXT_RE = /[\u200B-\u200D\u2060\uFEFF]/g
const HTTP_URL_RE = /https?:\/\/[^\s"'<>`]+/i
const TRAILING_TEXT_PUNCTUATION_RE = /[，。；、）】》]+$/g

export const normalizeSubscriptionUrlInput = (value: string) => {
  const stripped = value.replace(INVISIBLE_TEXT_RE, '').trim()
  if (/^(?:pewpew|clash|clash-verge):\/\//i.test(stripped)) {
    try {
      const link = new URL(stripped)
      const raw = link.search.slice(1).match(/(?:^|&)url=(.*)/)?.[1]
      if (!raw) return ''
      // Legacy unescaped links may have subscription parameters after url=.
      if (/^https?:\/\//i.test(raw)) return raw.split('&name=')[0]
      const nested = link.searchParams.get('url') || ''
      if (/^https?:\/\//i.test(nested)) return nested
      return decodeURIComponent(nested)
    } catch {
      return stripped
    }
  }
  const source = /^https?:\/\//i.test(stripped)
    ? stripped.replace(/\s+/g, '')
    : stripped

  const match = source.match(HTTP_URL_RE)
  const url = (match?.[0] ?? source).replace(/&amp;/gi, '&').trim()

  return url.replace(TRAILING_TEXT_PUNCTUATION_RE, '')
}

export const isSubscriptionUrl = (value: string) => {
  try {
    const url = new URL(normalizeSubscriptionUrlInput(value))
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname
  } catch {
    return false
  }
}
