/**
 * 從伺服器讀取本次部署的 build-id，與目前 bundle 內嵌版本比對。
 * 不一致時強制重新載入以取得最新前端（優先 /api/build-id，備援 /build-id.txt）。
 *
 * 僅 reload() 時，舊 Service Worker 仍可能持續用 precache 餵舊 HTML/JS（尤其「加到主畫面」的 PWA）。
 * 因此在 mismatch 時先 unregister SW + 清掉本網域 Cache Storage，再重整。
 */
async function unregisterSwAndClearSiteCaches(): Promise<void> {
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
  const urls = [`/api/build-id?cb=${cb}`, `/build-id.txt?cb=${cb}`]
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
  if (!embedded || embedded.startsWith('local-')) return

  try {
    const remote = await fetchRemoteBuildId()
    if (!remote || remote === embedded) return
    await unregisterSwAndClearSiteCaches()
    window.location.reload()
  } catch {
    /* 離線或請求失敗：不中斷操作 */
  }
}
