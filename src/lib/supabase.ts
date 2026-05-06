import { createClient, type Session } from '@supabase/supabase-js'

import {
  reportConnectionRepairTelemetry,
  reportRealtimeEngine,
  reportResumeEvent,
} from './resumeRealtimeTelemetry'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

function supabaseFetchLogEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('fetchlog') === '1' || q.get('debug') === '1') return true
    if (sessionStorage.getItem('tm_fetchlog') === '1') return true
    if (localStorage.getItem('tm_fetchlog') === '1') return true
    return false
  } catch {
    return false
  }
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[TsMedia] Supabase env vars not set — running in offline mode.')
}

/** iOS PWA 回前景後偶有 fetch 永不出結果；包一層逾時避免整個 UI 卡在 loading（abort 後由上層重試／換發 JWT）。 */
const nativeFetch = globalThis.fetch.bind(globalThis)

let supabaseFetchLogSeq = 0

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

  const t0 =
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()

  let pathHint = urlStr
  try {
    pathHint = new URL(urlStr).pathname + new URL(urlStr).search
  } catch {
    pathHint = urlStr.slice(0, 120)
  }

  const logOn = supabaseFetchLogEnabled()
  const rid = ++supabaseFetchLogSeq

  if (logOn) {
    const method =
      init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
    console.info('[tsmedia:supabase-fetch:start]', {
      rid,
      budgetMs: ms,
      method: String(method || 'GET'),
      path: pathHint.slice(0, 180),
    })
  }

  const pendingWarnAfter = Math.min(isAuth ? 18_000 : 9_500, ms - 2_500)
  const pendingTid =
    logOn && pendingWarnAfter >= 4_000
      ? globalThis.setTimeout(() => {
          const elapsed =
            (typeof performance !== 'undefined' && performance.now
              ? performance.now()
              : Date.now()) - t0
          console.warn('[tsmedia:supabase-fetch:still-pending]', {
            rid,
            elapsedMs: Math.round(elapsed),
            path: pathHint.slice(0, 180),
          })
        }, pendingWarnAfter)
      : null

  /**
   * 少數 WebKit／PWA：`ctrl.abort()` 後底層 `fetch` 仍永不 resolve／reject，UI 會卡在 await。
   * 再套一層硬逾時強制 reject（與 soft abort 並行），讓上層能重試或顯示錯誤。
   */
  const hardCapMs = ms + 6_000
  let hardTid: ReturnType<typeof globalThis.setTimeout> | null = null
  const hardFail = (): DOMException => {
    try {
      return new DOMException('Supabase fetch hard timeout', 'AbortError')
    } catch {
      return new DOMException('AbortError', 'AbortError')
    }
  }

  const chain = nativeFetch(input as RequestInfo, { ...init, signal: ctrl.signal })

  const raced = Promise.race([
    chain,
    new Promise<Response>((_, reject) => {
      hardTid = globalThis.setTimeout(() => {
        hardTid = null
        try {
          ctrl.abort()
        } catch {
          /* ignore */
        }
        reject(hardFail())
      }, hardCapMs)
    }),
  ])

  return raced
    .then((res) => {
      if (logOn) {
        const elapsed =
          (typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now()) - t0
        console.info('[tsmedia:supabase-fetch:done]', {
          rid,
          elapsedMs: Math.round(elapsed),
          status: res.status,
          path: pathHint.slice(0, 180),
        })
      }
      return res
    })
    .catch((err: unknown) => {
      if (logOn) {
        const elapsed =
          (typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now()) - t0
        console.warn('[tsmedia:supabase-fetch:error]', {
          rid,
          elapsedMs: Math.round(elapsed),
          path: pathHint.slice(0, 180),
          err: err instanceof Error ? err.message : String(err),
        })
      }
      throw err
    })
    .finally(() => {
      globalThis.clearTimeout(tid)
      if (hardTid != null) {
        globalThis.clearTimeout(hardTid)
        hardTid = null
      }
      if (pendingTid != null) globalThis.clearTimeout(pendingTid)
      parent?.removeEventListener('abort', onParentAbort)
    })
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    /**
     * 預設使用 Web Locks（navigator.locks）做跨分頁同步。React Strict Mode 會雙掛載、
     * 加上 wake／invalidate 並發 getSession／refresh 時，容易出現 console：
     * 「Lock broken by steal」→ 連鎖 Abort → `[db] getProfile error` 其實不是 RLS。
     * PWA／單頁為主時改用行程內直接執行（不通過 Web Locks）。
     * 若使用者常開多個同源分頁同時操作登入，再改回預設或自訂較安全的 lock。
     */
    lock: async (_name, _acquireTimeout, fn) => fn(),
  },
  db: {
    /** PostgREST：官方逾時；與 global.fetch 並用避免只靠其中一層 */
    timeout: 28_000,
  },
  global: {
    fetch: supabaseTimedFetch,
  },
})

/**
 * iOS PWA：`getSession` 常瞬間得到「看似有效」的 JWT，REST 仍整批掛死；用 sessionStorage 在
 * hidden／BFCache resume 打一個跨 React 監聽的記號，`ensureConnection` 強制換發+wake。
 * （不依賴單一分頁／effect 競態。）
 */
const IOS_RESUME_AUTH_REPAIR_KEY = 'tm_ios_resume_needs_full_auth'

function markIosNeedsFullAuthRepairAfterHiddenOrCache(): void {
  try {
    sessionStorage.setItem(IOS_RESUME_AUTH_REPAIR_KEY, '1')
  } catch {
    /* private mode／quota */
  }
}

function iosResumeFullAuthRepairPending(): boolean {
  try {
    return sessionStorage.getItem(IOS_RESUME_AUTH_REPAIR_KEY) === '1'
  } catch {
    return false
  }
}

function clearIosResumeFullAuthRepairFlag(): void {
  try {
    sessionStorage.removeItem(IOS_RESUME_AUTH_REPAIR_KEY)
  } catch {
    /* ignore */
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      markIosNeedsFullAuthRepairAfterHiddenOrCache()
      reportResumeEvent('visibility_hidden')
    } else if (document.visibilityState === 'visible') {
      reportResumeEvent('visibility_visible')
    }
  })
  /** BFCache：`visibilitychange` 未必再發；persisted pageshow 視同冷凍復原後必須重撿連線狀態。 */
  window.addEventListener('pageshow', (ev: Event) => {
    const e = ev as PageTransitionEvent
    if (e.persisted) markIosNeedsFullAuthRepairAfterHiddenOrCache()
    reportResumeEvent('pageshow', { persisted: Boolean(e.persisted) })
  })
  window.addEventListener('pagehide', (ev: Event) => {
    const e = ev as PageTransitionEvent
    if (e.persisted) {
      markIosNeedsFullAuthRepairAfterHiddenOrCache()
      reportResumeEvent('pagehide_bf_cache')
    }
  })
  /** Page Lifecycle（Chromium／部分 WebView）：對齊 Freeze 備案。 */
  document.addEventListener('freeze', () => {
    markIosNeedsFullAuthRepairAfterHiddenOrCache()
    reportResumeEvent('freeze')
  })
}

let wakeMutex: Promise<void> | null = null

/** 整段 wake 卡住時仍能釋放 mutex，避免後續 `await wake`／REST 請求全系統凍結。 */
const WAKE_OVERALL_BUDGET_MS = 42_000
/** `getSession` 理應同步讀 cache；但在 iOS 背景蟄伏後偶有 Promise 不落盤的假死情況。（與 `ensureConnection` 同一 2s 規格） */
const AUTH_GET_SESSION_BUDGET_MS = 2_000
/** `disconnect()` 理論上要 resolve；Frozen WebSocket／runtime 異常時要硬截斷。 */
const REALTIME_DISCONNECT_BUDGET_MS = 13_500

async function realtimeDisconnectBudgeted(rt: typeof supabase.realtime): Promise<void> {
  const p = rt.disconnect().catch(() => undefined as void)
  const t = new Promise<void>((resolve) =>
    globalThis.setTimeout(resolve, REALTIME_DISCONNECT_BUDGET_MS),
  )
  await Promise.race([p.then(() => undefined), t]).catch(() => undefined)
}

/**
 * iOS Safari／PWA：進背景時計時器暫停，`autoRefreshToken` 可能沒換發 JWT；
 * 回前景後請求會帶過期 token → `getProfile`／RPC 空資料或失敗。
 * 於 visibility / pageshow 呼叫一次（由 MainScreen debounce）。
 *
 * **Zombie／mutex：** 任一 `await`（含 `disconnect`／`refreshSession`）若永久懸吊，`wakeMutex` 不得永遠佔鎖，
 * 否則全域 `wakeSupabaseAuthFromBackground()` 卡住 → `db.ts` 在前景呼叫 `await wake()` 會跟著永不返回。
 * 用 **整段 budget**（`Promise.race`）保證 `finally` 能清 mutex；逾時後仍對 Realtime **disconnect／connect**
 * 盡可能甩掉僵死連線。（內圈若晚點結束仍可跑完，至多短暫重疊換發／重連一次。）
 *
 * 換發後對 Realtime `setAuth`，並 **disconnect→connect** 甩掉進背景後僵死的 WS。
 *
 * 與 TanStack Query（`refetchOnWindowFocus` 等）分工：此函式負責 JWT／Realtime；Query 負責已掛 `useQuery` 的資料。
 */
export function wakeSupabaseAuthFromBackground(): Promise<void> {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return Promise.resolve()
  }

  if (!wakeMutex) {
    const rt = supabase.realtime

    const attemptWakeInner = async () => {
      type PeekOk = { kind: 'ok'; session: Session | null; sessErr: unknown }
      type PeekSlow = { kind: 'slow' }

      let peek: PeekOk | PeekSlow
      try {
        peek = await Promise.race([
          supabase.auth.getSession().then(
            ({ data: { session }, error: sessErr }): PeekOk => ({
              kind: 'ok',
              session,
              sessErr,
            }),
          ),
          new Promise<PeekSlow>((resolve) =>
            globalThis.setTimeout(() => resolve({ kind: 'slow' }), AUTH_GET_SESSION_BUDGET_MS),
          ),
        ])
      } catch {
        peek = { kind: 'slow' }
      }

      if (peek.kind === 'ok') {
        if (peek.sessErr || !peek.session) return
      }

      /** 慢路徑或快路徑已確認有使用者：一律 `refreshSession`，由 refresh token／storage 撐換發（對照 zombie `getSession`）。 */
      let refreshedToken: string | undefined
      try {
        const { data: refreshed, error: refErr } = await supabase.auth.refreshSession()
        refreshedToken = !refErr ? refreshed.session?.access_token : undefined
      } catch {
        refreshedToken = undefined
      }

      const fallbackAccess =
        peek.kind === 'ok' && peek.session?.access_token ? peek.session.access_token : undefined

      const token = refreshedToken ?? fallbackAccess

      try {
        if (token) {
          await supabase.realtime.setAuth(token)
        }
      } catch {
        /* ignore */
      }

      await realtimeDisconnectBudgeted(rt)
      try {
        rt.connect()
      } catch {
        /* ignore */
      }
    }

    wakeMutex = (async () => {
      reportRealtimeEngine('wake_attempt_start')
      const deadline = new Promise<void>((resolve) =>
        globalThis.setTimeout(resolve, WAKE_OVERALL_BUDGET_MS),
      )
      await Promise.race([attemptWakeInner(), deadline])
      reportRealtimeEngine('wake_after_inner_budget')

      /** iOS：`refreshSession／disconnect` 等若整輪卡住，budget 已到仍甩一次 realtime。 */
      if (document.visibilityState === 'visible') {
        await realtimeDisconnectBudgeted(rt).catch(() => undefined)
        try {
          rt.connect()
        } catch {
          /* ignore */
        }
        reportRealtimeEngine('wake_post_race_resync')
      }
    })().finally(() => {
      reportRealtimeEngine('wake_mutex_cleared')
      wakeMutex = null
    })
  }
  return wakeMutex
}

/** 診斷：不切換 JWT，只重連 Realtime WebSocket（對照是否 WS 僵死） */
export async function reconnectSupabaseRealtimeOnly(): Promise<void> {
  reportRealtimeEngine('reconnect_realtime_only_disconnect')
  try {
    await supabase.realtime.disconnect()
  } catch {
    /* ignore */
  }
  supabase.realtime.connect()
  reportRealtimeEngine('reconnect_realtime_only_connect')
}

/**
 * 診斷：`refreshSession` + `realtime.setAuth`，但不強制 disconnect／connect（對照 {@link wakeSupabaseAuthFromBackground}）。
 */
export async function refreshSupabaseAuthSoft(): Promise<void> {
  const {
    data: { session },
    error: sessErr,
  } = await supabase.auth.getSession()
  if (sessErr || !session) return
  const { data: refreshed, error: refErr } = await supabase.auth.refreshSession()
  const token = !refErr ? refreshed.session?.access_token : undefined
  if (token) supabase.realtime.setAuth(token)
}

/** 診斷：僅讀取／同步本地 Session，不換發 token */
export async function touchSupabaseAuthSessionRead(): Promise<void> {
  await supabase.auth.getSession()
}

/** 連線修復 UI／reload 協定（見 `ensureConnection`、`App.tsx`） */
export type ConnectionRepairDetail =
  | { phase: 'start'; attempt: number; message: string }
  | { phase: 'success' }
  | { phase: 'reload'; message: string }

export const CONNECTION_REPAIR_EVENT = 'tsmedia:connection-repair' as const

/** iOS：`getSession` 超過 2s 或得到 null/error 時先手動 `refreshSession` 試著喚回 WebKit 網路層；見 `wakeSupabaseAuthFromBackground`。 */
const ENSURE_SESSION_GUARD_MS = 2_000
const ENSURE_MAX_ATTEMPTS = 3

let ensureFlight: Promise<boolean> | null = null

function emitConnectionRepair(detail: ConnectionRepairDetail): void {
  reportConnectionRepairTelemetry(detail)
  window.dispatchEvent(new CustomEvent(CONNECTION_REPAIR_EVENT, { detail }))
}

/**
 * API 請求前先跑：先手動 `getSession`（≤2s），必要時 `refreshSession`，成功換發過才 `wake`（Realtime 重連）。
 * 最多 3 次；仍失敗且目前 **在線**，觸發 `window.location.reload()` 終極備案。
 * 離線或頁面在背景：**不強制**，直接略過以避免誤報。
 */
export async function ensureConnection(): Promise<boolean> {
  if (typeof document === 'undefined') return true
  if (document.visibilityState !== 'visible') return true
  if (!navigator.onLine) return true

  if (!ensureFlight) {
    ensureFlight = runEnsureWithRetries().finally(() => {
      ensureFlight = null
    })
  }
  return ensureFlight
}

const DEFAULT_ENSURE_AWAIT_BUDGET_MS = 5_500

/**
 * 前景 API 專用：**不要**無限 await `ensureConnection()`（iOS 換發／wake 可能卡住整分鐘）。
 * 最多等 `budgetMs` 就繼續打 PostgREST／RPC；換發可能仍在背景收尾。
 */
export async function ensureConnectionWithBudget(budgetMs = DEFAULT_ENSURE_AWAIT_BUDGET_MS): Promise<void> {
  if (typeof document === 'undefined') return
  if (document.visibilityState !== 'visible') return
  if (!navigator.onLine) return

  await Promise.race([
    ensureConnection().catch(() => undefined),
    new Promise<void>((resolve) => globalThis.setTimeout(resolve, budgetMs)),
  ])
}

const RESUME_REFRESH_BUDGET_MS = 14_000

let repairAuthFlight: Promise<void> | null = null

/**
 * Resume 的另一條強化路：**先換發 JWT**（與 ensure 並行視角不同，明確對齊 RLS／auth.uid）再接 {@link wakeSupabaseAuthFromBackground}。
 * 適用 WebKit／PWA 回前景後「HTTP 見 200 但資料空」或過期 token。
 */
export function repairAuthAfterResume(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (typeof document === 'undefined') return Promise.resolve()
  if (document.visibilityState !== 'visible') return Promise.resolve()
  if (!navigator.onLine) return Promise.resolve()

  if (!repairAuthFlight) {
    repairAuthFlight = (async () => {
      await Promise.race([
        supabase.auth
          .refreshSession()
          .then(() => undefined)
          .catch(() => undefined),
        new Promise<void>((resolve) => globalThis.setTimeout(resolve, RESUME_REFRESH_BUDGET_MS)),
      ])
      await wakeSupabaseAuthFromBackground()
    })().finally(() => {
      repairAuthFlight = null
    })
  }
  return repairAuthFlight
}

const PROFILE_TAB_READ_ENSURE_DEEP_MS = 14_000

/**
 * 「我的」載入／輪詢前先換發／wake／ensure。**勿**在此函式做短秒數 `Promise.race` 截斷：
 * `repairAuthAfterResume`（refresh 最多 14s + wake 內層至多約 42s）合理可超過 26s，
 * 截斷會讓換發打到一半就結束 await——接著 REST 仍以舊／僵線送出 → `poll` 整段卡住至 `busy` 永不釋放。
 * （整段 load／poll 的硬頂請在 ProfileTab 用單一大帽。）
 */
export async function prepareSupabaseForProfileReads(mode: 'load' | 'poll'): Promise<void> {
  if (typeof document === 'undefined') return
  if (document.visibilityState !== 'visible') return
  if (!navigator.onLine) return

  const deep = mode === 'load' || iosResumeFullAuthRepairPending()
  if (deep) {
    await repairAuthAfterResume()
    await ensureConnectionWithBudget(PROFILE_TAB_READ_ENSURE_DEEP_MS)
  } else {
    await ensureConnectionWithBudget()
  }
}

async function runEnsureWithRetries(): Promise<boolean> {
  for (let attempt = 1; attempt <= ENSURE_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      emitConnectionRepair({
        phase: 'start',
        attempt,
        message: `連線重置中…（${attempt}/${ENSURE_MAX_ATTEMPTS}）`,
      })
    }
    const ok = await ensureConnectionOnce()
    if (ok) {
      emitConnectionRepair({ phase: 'success' })
      return true
    }
    await new Promise((r) => globalThis.setTimeout(r, 140))
    await wakeSupabaseAuthFromBackground()
  }

  emitConnectionRepair({ phase: 'reload', message: '連線異常，正在重新載入應用…' })

  /** 離線不要做無限重整迴圈；僅在目前判定為線上時重載（避免 iOS SW／假連線卡住）。 */
  if (navigator.onLine) globalThis.window?.location.reload()
  return false
}

async function ensureConnectionOnce(): Promise<boolean> {
  if (!navigator.onLine) return false

  const resumedFromIosSuspend = iosResumeFullAuthRepairPending()

  type Tagged =
    | { tag: 'ok'; session: Session | null; err: unknown }
    | { tag: 'timeout' }

  let peek: Tagged
  try {
    peek = await Promise.race([
      supabase.auth.getSession().then(
        ({ data: { session }, error }): Tagged => ({
          tag: 'ok',
          session,
          err: error,
        }),
      ),
      new Promise<Tagged>((resolve) =>
        globalThis.setTimeout(() => resolve({ tag: 'timeout' }), ENSURE_SESSION_GUARD_MS),
      ),
    ])
  } catch {
    peek = { tag: 'timeout' }
  }

  if (peek.tag === 'ok' && !peek.err && !peek.session) {
    clearIosResumeFullAuthRepairFlag()
    return true
  }

  /** 從背景／BFCache 回來：**不得**只靠快取 JWT 快速路徑——常遇到「session 仍有、請求全系統凍結」。 */
  const needsManualRefresh =
    resumedFromIosSuspend ||
    peek.tag === 'timeout' ||
    (peek.tag === 'ok' && (Boolean(peek.err) || !peek.session))

  if (!needsManualRefresh && peek.tag === 'ok') {
    return true
  }

  const { error: refErr } = await supabase.auth.refreshSession()

  /** 換發失敗且已無 session：視為登出或未登入情境，不修 UI、不中斷資料流。 */
  if (refErr) {
    const { data: after } = await supabase.auth.getSession()
    if (!after.session) {
      clearIosResumeFullAuthRepairFlag()
      return true
    }
    return false
  }

  await wakeSupabaseAuthFromBackground()
  clearIosResumeFullAuthRepairFlag()
  return true
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (document.visibilityState === 'visible') {
      reportResumeEvent('online')
      void ensureConnection()
    }
  })
}
