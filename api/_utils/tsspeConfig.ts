/** TSSPE 上線切點：Stage2 sent_at 須 >= 此時間才有 checkout 資格（immutable ISO UTC）。 */

export const TSSPE_DISCOUNT_NTD = 150
export const TSSPE_MEMBERSHIP_DISCOUNT_CODE = 'TSSPE'

/**
 * Deploy 前於 Vercel Production 設定環境變數 `TSSPE_GO_LIVE`（ISO-8601 UTC，例如 2026-03-20T08:00:00.000Z）。
 * 未設定時 TSSPE checkout 一律 fail closed（與 tests 注入不同）。
 */
export function readTsspeGoLiveMs(): number | null {
  const raw = process.env.TSSPE_GO_LIVE?.trim()
  if (!raw) return null
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** Tests / explicit override only */
export function readTsspeGoLiveMsWithOverride(overrideIso: string | null | undefined): number | null {
  if (overrideIso != null && overrideIso !== '') {
    const ms = new Date(overrideIso).getTime()
    return Number.isFinite(ms) ? ms : null
  }
  return readTsspeGoLiveMs()
}
