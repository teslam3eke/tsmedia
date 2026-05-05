/** `?eruda=1` 或 `?debug=1`：本工作階段啟用 Eruda • `?debug=1`／`?fetchlog=1`：Console 印出每筆 Supabase fetch（Eruda Network 在 iOS 常不完整）• `localStorage.setItem('tm_eruda','1')`／`tm_fetchlog`：跨重開仍啟用 • `?eruda=0`／`?debug=0`／`?fetchlog=0`：關閉對應旗標 */

const STORAGE_KEY = 'tm_eruda'

export async function maybeInitEruda(): Promise<void> {
  if (typeof window === 'undefined') return

  let params: URLSearchParams
  try {
    params = new URLSearchParams(window.location.search)
  } catch {
    return
  }

  const off = params.get('eruda') === '0' || params.get('debug') === '0'
  if (off) {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(STORAGE_KEY)
      sessionStorage.removeItem('tm_fetchlog')
    } catch {
      /* quota / private mode */
    }
    return
  }

  const fromQuery = params.get('eruda') === '1' || params.get('debug') === '1'
  if (fromQuery) {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  if (params.get('fetchlog') === '1' || params.get('debug') === '1') {
    try {
      sessionStorage.setItem('tm_fetchlog', '1')
    } catch {
      /* ignore */
    }
  }
  if (params.get('fetchlog') === '0') {
    try {
      sessionStorage.removeItem('tm_fetchlog')
    } catch {
      /* ignore */
    }
  }

  let sessionOn = false
  let localOn = false
  try {
    sessionOn = sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    /* ignore */
  }
  try {
    localOn = localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    /* ignore */
  }

  const enabled = Boolean(import.meta.env.DEV || sessionOn || localOn)
  if (!enabled) return

  const erudaModule = await import('eruda')
  const eruda = erudaModule.default
  eruda.init()
}
