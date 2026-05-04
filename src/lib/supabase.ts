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
 * 於 visibility / pageshow 呼叫一次（由 MainScreen debounce）；一律嘗試 refreshSession（含逾時保護）。
 */
export function wakeSupabaseAuthFromBackground(): Promise<void> {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return Promise.resolve()
  }

  if (!wakeMutex) {
    wakeMutex = (async () => {
      const TIMEOUT_MS = 12_000
      const run = async () => {
        try {
          const { data: { session }, error: sessErr } = await supabase.auth.getSession()
          if (sessErr || !session) return
          // iOS PWA：expires_at 有時仍「看起來有效」但請求已被拒；回前景一律換發一次最穩。
          await supabase.auth.refreshSession()
        } catch {
          /* 離線或競態：略過 */
        }
      }
      await Promise.race([
        run(),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, TIMEOUT_MS)
        }),
      ])
    })().finally(() => {
      wakeMutex = null
    })
  }
  return wakeMutex
}
