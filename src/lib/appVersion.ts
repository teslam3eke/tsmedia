/**
 * 從伺服器讀取本次部署的 build-id，與目前 bundle 內嵌版本比對。
 * 不一致時強制重新載入以取得最新前端（搭配 dist/build-id.txt）。
 */
export async function checkRemoteBuildIdAndReload(): Promise<void> {
  if (import.meta.env.DEV) return
  const embedded = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__.trim() : ''
  if (!embedded || embedded.startsWith('local-')) return

  try {
    const res = await fetch(`/build-id.txt?cb=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'text/plain' },
    })
    if (!res.ok) return
    const remote = (await res.text()).trim()
    if (remote && remote !== embedded) {
      window.location.reload()
    }
  } catch {
    /* 離線或請求失敗：不中斷操作 */
  }
}
