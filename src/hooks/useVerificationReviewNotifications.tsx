import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import {
  getUnreadAppNotifications,
  markAppNotificationRead,
  subscribeToMyAppNotifications,
} from '@/lib/db'
import type { AppNotificationRow } from '@/lib/types'
import {
  VERIFICATION_APPLICATION_REJECTION_FOOTER,
  formatVerificationApplicationRejectionAlertBody,
  parseVerificationRejectionReasonFromBody,
} from '@/lib/verificationAiUtils'

type VerificationReviewKind = 'verification_approved' | 'verification_rejected'
const LOCAL_REVIEW_ID_PREFIX = 'local-review-status:'

function isVerificationReviewKind(kind: string): kind is VerificationReviewKind {
  return kind === 'verification_approved' || kind === 'verification_rejected'
}

function VerificationReviewAlert({
  notification,
  onDismiss,
}: {
  notification: AppNotificationRow
  onDismiss: () => void
}) {
  const approved = notification.kind === 'verification_approved'
  const rejectionReason = approved
    ? null
    : parseVerificationRejectionReasonFromBody(notification.body)
  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-slate-950/55 px-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-review-alert-title"
    >
      <div
        className={`w-full max-w-sm rounded-3xl p-6 shadow-2xl ring-1 ${
          approved ? 'bg-emerald-50 ring-emerald-200' : 'bg-red-50 ring-red-200'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
              approved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {approved ? <ShieldCheck className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="verification-review-alert-title"
              className={`text-base font-bold ${approved ? 'text-emerald-800' : 'text-red-800'}`}
            >
              {notification.title}
            </h2>
            {approved ? (
              <p className={`mt-2 text-sm leading-relaxed text-emerald-700`}>{notification.body}</p>
            ) : (
              <div className="mt-2 space-y-2">
                {rejectionReason ? (
                  <div className="rounded-2xl bg-white/80 px-3 py-2.5 ring-1 ring-red-200">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-red-600">退件原因</p>
                    <p className="mt-1 text-sm leading-relaxed text-red-800">{rejectionReason}</p>
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-red-700">{notification.body}</p>
                )}
                <p className="text-xs leading-relaxed text-red-700">{VERIFICATION_APPLICATION_REJECTION_FOOTER}</p>
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className={`mt-5 w-full rounded-2xl py-3 text-sm font-bold text-white ${
            approved ? 'bg-emerald-600 active:bg-emerald-700' : 'bg-red-600 active:bg-red-700'
          }`}
        >
          我知道了
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** 審核等待／付費牆：即時接收 verification_* 通知（Realtime + backlog + 前景本地推播） */
export function useVerificationReviewNotifications(opts: {
  userId?: string
  enabled: boolean
  onApproved?: () => void
  onRejected?: () => void
}) {
  const { userId, enabled, onApproved, onRejected } = opts
  const seenIdsRef = useRef(new Set<string>())
  const activeKindRef = useRef<VerificationReviewKind | null>(null)
  const [activeAlert, setActiveAlert] = useState<AppNotificationRow | null>(null)

  const handleRow = useCallback(
    (row: AppNotificationRow) => {
      if (!isVerificationReviewKind(row.kind)) return
      if (seenIdsRef.current.has(row.id)) return
      seenIdsRef.current.add(row.id)

      // 輪詢可能比 Realtime 先偵測到結果；同一結果只顯示一次，
      // 但仍將稍後抵達的資料庫通知標為已讀，避免切頁後再次彈出。
      if (activeKindRef.current === row.kind) {
        if (!row.id.startsWith(LOCAL_REVIEW_ID_PREFIX)) void markAppNotificationRead(row.id)
        return
      }
      activeKindRef.current = row.kind
      setActiveAlert((prev) => prev ?? row)
    },
    [],
  )

  useEffect(() => {
    seenIdsRef.current.clear()
    activeKindRef.current = null
    setActiveAlert(null)
  }, [userId, enabled])

  useEffect(() => {
    if (!userId || !enabled) return

    let cancelled = false
    void (async () => {
      const list = await getUnreadAppNotifications(userId)
      if (cancelled) return
      for (const row of list) {
        if (isVerificationReviewKind(row.kind)) handleRow(row)
      }
    })()

    const unsubscribe = subscribeToMyAppNotifications(userId, (row) => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      handleRow(row)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [userId, enabled, handleRow])

  /** profiles 輪詢備援：即使 Realtime／app_notifications 暫時延遲，也先顯示審核結果。 */
  const notifyReviewResult = useCallback(
    (kind: VerificationReviewKind, opts?: { reviewerNote?: string | null }) => {
      if (!userId || !enabled) return
      const approved = kind === 'verification_approved'
      handleRow({
        id: `${LOCAL_REVIEW_ID_PREFIX}${userId}:${kind}`,
        user_id: userId,
        kind,
        title: approved ? '會員審核已通過' : '會員審核未通過',
        body: approved
          ? '你的身分與任職認證已通過。'
          : formatVerificationApplicationRejectionAlertBody(opts?.reviewerNote),
        ref_match_id: null,
        read_at: null,
        created_at: new Date().toISOString(),
      })
    },
    [userId, enabled, handleRow],
  )

  const dismissAlert = useCallback(() => {
    if (!activeAlert) return
    if (!activeAlert.id.startsWith(LOCAL_REVIEW_ID_PREFIX)) {
      void markAppNotificationRead(activeAlert.id)
    }
    activeKindRef.current = null
    setActiveAlert(null)
    // 先讓使用者看見結果；按下「我知道了」後才切換畫面，避免 hook
    // 在狀態更新瞬間被卸載而讓彈窗消失。
    if (activeAlert.kind === 'verification_approved') onApproved?.()
    if (activeAlert.kind === 'verification_rejected') onRejected?.()
  }, [activeAlert, onApproved, onRejected])

  const alertPortal = activeAlert ? (
    <VerificationReviewAlert notification={activeAlert} onDismiss={dismissAlert} />
  ) : null

  return { alertPortal, notifyReviewResult }
}
