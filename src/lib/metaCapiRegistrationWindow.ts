/** 與 migration claim_meta_capi_complete_registration 的 7 日窗口一致（Meta 可接受延遲上限）。 */
export const REGISTRATION_CAPI_MAX_AGE_MS = 7 * 24 * 3600 * 1000

export function isRegistrationCapiWindowOpen(registeredAtIso: string, nowMs = Date.now()): boolean {
  const t = new Date(registeredAtIso).getTime()
  if (!Number.isFinite(t)) return false
  return nowMs - t <= REGISTRATION_CAPI_MAX_AGE_MS
}
