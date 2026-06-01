const INVISIBLE_TEXT_RE = /[\u200B-\u200D\u2060\uFEFF]/g
const HTTP_URL_RE = /https?:\/\/[^\s"'<>`]+/i
const TRAILING_TEXT_PUNCTUATION_RE = /[，。；、）】》]+$/g

export const normalizeSubscriptionUrlInput = (value: string) => {
  const stripped = value.replace(INVISIBLE_TEXT_RE, '').trim()
  const source = /^https?:\/\//i.test(stripped)
    ? stripped.replace(/\s+/g, '')
    : stripped

  const match = source.match(HTTP_URL_RE)
  const url = (match?.[0] ?? source).replace(/&amp;/gi, '&').trim()

  return url.replace(TRAILING_TEXT_PUNCTUATION_RE, '')
}

export const isSubscriptionUrl = (value: string) =>
  /^https?:\/\//i.test(normalizeSubscriptionUrlInput(value))
