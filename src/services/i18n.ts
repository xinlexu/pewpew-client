import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

export const supportedLanguages = [
  'en',
  'ru',
  'zh',
  'fa',
  'tt',
  'id',
  'ar',
  'ko',
  'tr',
  'de',
  'es',
  'jp',
  'zhtw',
]

export const FALLBACK_LANGUAGE = 'zh'
const LANGUAGE_STORAGE_KEY = 'verge-language'
const CLIENT_LANGUAGE_MODE_STORAGE_KEY = 'pewpew-language-mode'

export type ClientLanguageMode = 'system' | 'zh-CN' | 'en-US'

const normalizeLanguage = (language?: string) =>
  language?.toLowerCase().replace(/_/g, '-')

export const resolveLanguage = (language?: string) => {
  const normalized = normalizeLanguage(language)
  if (!normalized) {
    return FALLBACK_LANGUAGE
  }

  if (normalized === 'zh-tw') return 'zhtw'
  if (normalized === 'zh-cn') return 'zh'

  if (supportedLanguages.includes(normalized)) {
    return normalized
  }

  const baseLanguage = normalized.split('-')[0]
  if (supportedLanguages.includes(baseLanguage)) {
    return baseLanguage
  }

  return FALLBACK_LANGUAGE
}

const getNavigatorLanguages = () => {
  if (typeof navigator === 'undefined') return []
  const languages = Array.isArray(navigator.languages)
    ? navigator.languages
    : []
  return [navigator.language, ...languages].filter(Boolean)
}

export const resolveSystemClientLanguage = () => {
  const languages = getNavigatorLanguages()
  if (
    languages.some((language) => normalizeLanguage(language)?.startsWith('zh'))
  ) {
    return 'zh'
  }
  return 'en'
}

export const resolveClientLanguage = (language?: string) => {
  const normalized = normalizeLanguage(language)
  if (!normalized) return resolveSystemClientLanguage()
  if (normalized.startsWith('zh')) return 'zh'
  if (normalized.startsWith('en')) return 'en'
  if (normalized === 'system') return resolveSystemClientLanguage()
  return 'en'
}

export const resolveClientLanguageMode = (
  mode: ClientLanguageMode = 'system',
) => {
  if (mode === 'zh-CN') return 'zh'
  if (mode === 'en-US') return 'en'
  return resolveSystemClientLanguage()
}

export const normalizeClientLanguageMode = (
  value?: string | null,
): ClientLanguageMode | undefined => {
  if (value === 'system' || value === 'zh-CN' || value === 'en-US') {
    return value
  }
  return undefined
}

const getLanguageStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const cacheLanguage = (language: string) => {
  const storage = getLanguageStorage()
  if (!storage) return

  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, resolveLanguage(language))
  } catch (error) {
    console.warn('[i18n] Failed to cache language:', error)
  }
}

export const getCachedLanguage = () => {
  const storage = getLanguageStorage()
  if (!storage) return undefined

  try {
    const cached = storage.getItem(LANGUAGE_STORAGE_KEY)
    return cached ? resolveLanguage(cached) : undefined
  } catch (error) {
    console.warn('[i18n] Failed to read cached language:', error)
    return undefined
  }
}

export const cacheClientLanguageMode = (mode: ClientLanguageMode) => {
  const storage = getLanguageStorage()
  if (!storage) return

  try {
    storage.setItem(CLIENT_LANGUAGE_MODE_STORAGE_KEY, mode)
  } catch (error) {
    console.warn('[i18n] Failed to cache client language mode:', error)
  }
}

export const getCachedClientLanguageMode = () => {
  const storage = getLanguageStorage()
  if (!storage) return undefined

  try {
    return normalizeClientLanguageMode(
      storage.getItem(CLIENT_LANGUAGE_MODE_STORAGE_KEY),
    )
  } catch (error) {
    console.warn('[i18n] Failed to read client language mode:', error)
    return undefined
  }
}

type LocaleModule = {
  default: Record<string, unknown>
}

const localeModules = import.meta.glob<LocaleModule>('@/locales/*/index.ts')

const localeLoaders = Object.entries(localeModules).reduce<
  Record<string, () => Promise<LocaleModule>>
>((acc, [path, loader]) => {
  const match = path.match(/[/\\]locales[/\\]([^/\\]+)[/\\]index\.ts$/)
  if (match) {
    acc[match[1]] = loader
  }
  return acc
}, {})

export const languages: Record<string, any> = supportedLanguages.reduce(
  (acc, lang) => {
    acc[lang] = {}
    return acc
  },
  {} as Record<string, any>,
)

export const loadLanguage = async (language: string) => {
  try {
    const loader = localeLoaders[language]
    if (!loader) {
      throw new Error(`Locale loader not found for language "${language}"`)
    }
    const module = await loader()
    return module.default
  } catch (error) {
    if (language !== FALLBACK_LANGUAGE) {
      console.warn(
        `Failed to load language ${language}, fallback to ${FALLBACK_LANGUAGE}, ${error}`,
      )
      const fallbackLoader = localeLoaders[FALLBACK_LANGUAGE]
      if (!fallbackLoader) {
        throw new Error(
          `Fallback language "${FALLBACK_LANGUAGE}" resources are missing.`,
          { cause: error },
        )
      }
      const fallback = await fallbackLoader()
      return fallback.default
    }
    throw error
  }
}

i18n.use(initReactI18next).init({
  resources: {},
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
})

export const changeLanguage = async (language: string) => {
  const targetLanguage = resolveLanguage(language)

  if (!i18n.hasResourceBundle(targetLanguage, 'translation')) {
    const resources = await loadLanguage(targetLanguage)
    i18n.addResourceBundle(targetLanguage, 'translation', resources)
  }

  await i18n.changeLanguage(targetLanguage)
  cacheLanguage(targetLanguage)
}

export const changeClientLanguageMode = async (mode: ClientLanguageMode) => {
  cacheClientLanguageMode(mode)
  const targetLanguage = resolveClientLanguageMode(mode)
  await changeLanguage(targetLanguage)
  return targetLanguage
}

export const initializeLanguage = async (
  initialLanguage: string = FALLBACK_LANGUAGE,
) => {
  await changeLanguage(initialLanguage)
}
