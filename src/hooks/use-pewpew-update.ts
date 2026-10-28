import { useQuery } from '@tanstack/react-query'
import type { Update } from '@tauri-apps/plugin-updater'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { showNotice } from '@/services/notice-service'
import { checkForPewPewUpdate } from '@/services/update'

const UPDATE_QUERY_KEY = ['pewpewUpdate'] as const
const LAST_AUTO_CHECK_KEY = 'pewpew-update-last-auto-check'
const NOTIFIED_VERSION_KEY = 'pewpew-update-notified-version'
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const AUTO_CHECK_DELAY_MS = 8000

type UpdateCheckResult = { update: Update | null; checkedAt: number }

// One shared update check for the About dialog, the header badge and the
// background check.
export const usePewPewUpdate = () => {
  const query = useQuery({
    queryKey: UPDATE_QUERY_KEY,
    queryFn: async (): Promise<UpdateCheckResult> => ({
      update: await checkForPewPewUpdate(),
      checkedAt: Date.now(),
    }),
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  const { refetch } = query
  const check = useCallback(() => refetch(), [refetch])
  return {
    update: query.data?.update ?? null,
    checked: !!query.data && !query.isFetching,
    checking: query.isFetching,
    failed: query.isError && !query.isFetching,
    check,
  }
}

const readStorage = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

// Quietly checks once a day after startup and mentions a new version once.
// Manual checks in the About dialog show their result there instead.
export const useDailyUpdateCheck = () => {
  const { t } = useTranslation()
  const { check } = usePewPewUpdate()

  useEffect(() => {
    const now = Date.now()
    const stored = Number(readStorage(LAST_AUTO_CHECK_KEY) || 0)
    const last =
      Number.isFinite(stored) && stored > 0 && stored <= now ? stored : 0
    let active = true
    let timer: number
    const runCheck = async () => {
      if (!active) return
      writeStorage(LAST_AUTO_CHECK_KEY, String(Date.now()))
      try {
        const { data } = await check()
        const update = data?.update
        if (!active || !update) return
        if (readStorage(NOTIFIED_VERSION_KEY) === update.version) return
        writeStorage(NOTIFIED_VERSION_KEY, update.version)
        showNotice.info(
          t('home.pewpew.update.available', { version: update.version }),
        )
      } catch {
        // Background failures stay quiet; manual checks show the error.
      } finally {
        if (active) timer = window.setTimeout(runCheck, AUTO_CHECK_INTERVAL_MS)
      }
    }
    timer = window.setTimeout(
      runCheck,
      Math.max(AUTO_CHECK_DELAY_MS, last + AUTO_CHECK_INTERVAL_MS - now),
    )
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [check, t])
}
