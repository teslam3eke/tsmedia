import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[TsMedia] Supabase env vars not set — running in offline mode.')
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
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
 * 換發後對 Realtime `setAuth`，否則 WS 可能仍握過期 JWT，配對訂閱與部分請求像「整個後端挂掉」。
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
      } catch {
        /* 離線或競態：略過 */
      }
    })().finally(() => {
      wakeMutex = null
    })
  }
  return wakeMutex
}
