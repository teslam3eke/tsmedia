import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[TsMedia] Supabase env vars not set — running in offline mode.')
}

/** iOS PWA 回前景後偶有 fetch 永不出結果；包一層逾時避免整個 UI 卡在 loading（abort 後由上層重試／換發 JWT）。 */
const nativeFetch = globalThis.fetch.bind(globalThis)

function supabaseTimedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url

  if (!urlStr.includes('.supabase.co')) {
    return nativeFetch(input as RequestInfo, init)
  }

  const isAuth = urlStr.includes('/auth/v1/')
  const ms = isAuth ? 45_000 : 28_000
  const ctrl = new AbortController()
  const tid = globalThis.setTimeout(() => ctrl.abort(), ms)
  const parent = init?.signal
  const onParentAbort = () => ctrl.abort()
  if (parent) {
    if (parent.aborted) ctrl.abort()
    else parent.addEventListener('abort', onParentAbort, { once: true })
  }

  return nativeFetch(input as RequestInfo, { ...init, signal: ctrl.signal }).finally(() => {
    globalThis.clearTimeout(tid)
    parent?.removeEventListener('abort', onParentAbort)
  })
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
  db: {
    /** PostgREST：官方逾時；與 global.fetch 並用避免只靠其中一層 */
    timeout: 28_000,
  },
  global: {
    fetch: supabaseTimedFetch,
  },
})

let wakeMutex: Promise<void> | null = null

/**
 * iOS Safari／PWA：進背景時計時器暫停，`autoRefreshToken` 可能沒換發 JWT；
 * 回前景後請求會帶過期 token → `getProfile`／RPC 空資料或失敗。
 * 於 visibility / pageshow 呼叫一次（由 MainScreen debounce）。
 *
 * 務必 **await 整段 refresh 結束** 才釋放 mutex：先前用 `Promise.race` 提前 resolve 時，
 * mutex 已清空但 `refreshSession()` 仍在跑 → 下次前景又開一輪 refresh → auth／請求互卡。
 * 換發後對 Realtime `setAuth`，並 **disconnect→connect** 甩掉進背景後僵死的 WS（否則只有 REST 正常、訂閱／部分流程仍像全壞）。
 */
export function wakeSupabaseAuthFromBackground(): Promise<void> {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return Promise.resolve()
  }

  if (!wakeMutex) {
    wakeMutex = (async () => {
      try {
        const { data: { session }, error: sessErr } = await supabase.auth.getSession()
        if (sessErr || !session) return
        // iOS PWA：expires_at 有時仍「看起來有效」但請求已被拒；回前景一律換發一次最穩。
        const { data: refreshed, error: refErr } = await supabase.auth.refreshSession()
        const token = !refErr ? refreshed.session?.access_token : undefined
        if (token) supabase.realtime.setAuth(token)
        try {
          await supabase.realtime.disconnect()
        } catch {
          /* ignore */
        }
        supabase.realtime.connect()
      } catch {
        /* 離線或競態：略過 */
      }
    })().finally(() => {
      wakeMutex = null
    })
  }
  return wakeMutex
}
