/**
 * 從伺服器讀取本次部署的 build id（git SHA 前 12 碼），與 bundle 內 __APP_BUILD_ID__ 比對。
 * 不一致時強制重新載入以取得最新前端（優先 /api/git-sha，備援 /build-id.txt）。
 *
 * 僅 reload() 時，舊 Service Worker 仍可能持續用 precache 餵舊 HTML/JS（尤其「加到主畫面」的 PWA）。
 * 因此在 mismatch 且確定可 reload 時才 unregister SW + 清 Cache Storage，再重整。
 * 相簿 grace／註冊填表保護中則略過（勿先 unregister 卻不 reload，否則推播會中斷）。
 */

import { isWithinMediaPickerGracePeriod } from './resumeHardReload'
import { isOnboardingResumeProtectActive } from './onboardingDraft'
import { markSkipInstantMatchLeaveOnNextFullUnload } from './instantMatchUnloadGuard'

const MIN_PROBE_INTERVAL_MS = 20_000
let buildIdProbeInFlight = false
let lastBuildIdProbeEndedAt = 0
export async function unregisterSwAndClearSiteCaches(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
  } catch {
    /* ignore */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* ignore */
  }
}

async function fetchRemoteBuildId(): Promise<string | null> {
  const cb = Date.now()
  const urls = [`/api/git-sha?cb=${cb}`, `/build-id.txt?cb=${cb}`]
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'text/plain' },
      })
      if (!res.ok) continue
      const text = (await res.text()).trim()
      if (text && text !== 'build-id-unavailable') return text
    } catch {
      /* try next URL */
    }
  }
  return null
}

export async function checkRemoteBuildIdAndReload(): Promise<void> {
  if (import.meta.env.DEV) return
  const embedded = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__.trim() : ''
  if (!embedded || embedded.endsWith('-dev')) return

  if (buildIdProbeInFlight) return
  const since = Date.now() - lastBuildIdProbeEndedAt
  if (since < MIN_PROBE_INTERVAL_MS && lastBuildIdProbeEndedAt > 0) return

  buildIdProbeInFlight = true
  try {
    const remote = await fetchRemoteBuildId()
    if (!remote || remote === embedded) return
    if (isWithinMediaPickerGracePeriod()) return
    if (isOnboardingResumeProtectActive()) return
    await unregisterSwAndClearSiteCaches()
    markSkipInstantMatchLeaveOnNextFullUnload()
    window.location.reload()
  } catch {
    /* 離線或請求失敗：不中斷操作 */
  } finally {
    buildIdProbeInFlight = false
    lastBuildIdProbeEndedAt = Date.now()
  }
}
