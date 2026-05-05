/**
 * 前景／PWA 除錯：印出「程式走到哪」的時間序，方便對照 `[tsmedia:supabase-fetch:*]`。
 * 啟用方式（任一即可）：`?debug=1`、`?fetchlog=1`、`?actionlog=1`；
 * 或 `sessionStorage`／`localStorage` 設 `tm_fetchlog` / `tm_actionlog` 為 `1`。
 * 關閉：`?actionlog=0`；與 fetch 同時關閉可用 `?debug=0`（見 erudaBootstrap）。
 */

function readFlag(key: 'tm_fetchlog' | 'tm_actionlog'): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (sessionStorage.getItem(key) === '1') return true
    if (localStorage.getItem(key) === '1') return true
    return false
  } catch {
    return false
  }
}

export function clientActionTraceEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('debug') === '1' || q.get('fetchlog') === '1' || q.get('actionlog') === '1') return true
    if (readFlag('tm_fetchlog') || readFlag('tm_actionlog')) return true
    return false
  } catch {
    return false
  }
}

let actionSeq = 0

/** 非 PII：僅供日誌對照 */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—'
  const s = String(id)
  return s.length <= 10 ? s : `${s.slice(0, 8)}…`
}

/**
 * @param lane 區塊，例如 `profileTab`、`discover.deck`、`db.getProfile`
 * @param step 階段，建議用 `:` 分層，例如 `load:start`、`afterRpc`
 */
export function actionTrace(
  lane: string,
  step: string,
  detail?: Record<string, unknown>,
): void {
  if (!clientActionTraceEnabled()) return
  const aid = ++actionSeq
  let vis: string = 'n/a'
  try {
    if (typeof document !== 'undefined') vis = document.visibilityState
  } catch {
    /* private mode */
  }
  console.info(`[tsmedia:action:${lane}] ${step}`, {
    aid,
    ts: Date.now(),
    vis,
    ...(detail ?? {}),
  })
}

/** iOS／PWA：`await` 可能永不 resolve；強制結束並打日誌，仍讓呼叫端決定如何用 `null`。 */
export async function raceWithBudgetMs<T>(
  lane: string,
  step: string,
  budgetMs: number,
  p: Promise<T>,
): Promise<T | null> {
  type Win =
    | { kind: 'ok'; val: T }
    | { kind: 'to' }
    | { kind: 'rej'; err: unknown }

  let tm: ReturnType<typeof globalThis.setTimeout> | undefined
  try {
    const r = await Promise.race<Win>([
      p
        .then((val): Win => ({ kind: 'ok', val }))
        .catch((err): Win => ({ kind: 'rej', err })),
      new Promise<Win>((resolve) => {
        tm = globalThis.setTimeout(() => resolve({ kind: 'to' }), budgetMs)
      }),
    ])

    if (r.kind === 'to') {
      console.warn(`[tsmedia:timeout] ${lane} · ${step}`, { budgetMs })
      actionTrace(lane, `${step}:逾時`, { budgetMs })
      return null
    }
    if (r.kind === 'rej') {
      console.warn(`[tsmedia:promise-error] ${lane} · ${step}`, r.err)
      actionTrace(lane, `${step}:rejected`, {
        msg: r.err instanceof Error ? r.err.message.slice(0, 160) : String(r.err).slice(0, 160),
      })
      return null
    }
    return r.val
  } finally {
    if (tm != null) globalThis.clearTimeout(tm)
  }
}
