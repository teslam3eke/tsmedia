import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import {
  getUnreadAppNotifications,
  markAppNotificationRead,
  subscribeToMyAppNotifications,
} from '@/lib/db'
import type { AppNotificationRow } from '@/lib/types'

type VerificationReviewKind = 'verification_approved' | 'verification_rejected'

function isVerificationReviewKind(kind: string): kind is VerificationReviewKind {
  return kind === 'verification_approved' || kind === 'verification_rejected'
}

async function showForegroundVerificationNotice(row: AppNotificationRow): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (document.visibilityState !== 'visible') return
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  const options: NotificationOptions = {
    body: row.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `verification-review-${row.kind}`,
  }

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(row.title, options)
      return
    }
    new Notification(row.title, options)
  } catch {
    /* 前景本地通知失敗不阻斷流程 */
  }
}

function VerificationReviewAlert({
  notification,
  onDismiss,
}: {
  notification: AppNotificationRow
  onDismiss: () => void
}) {
  const approved = notification.kind === 'verification_approved'
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
            <p className={`mt-2 text-sm leading-relaxed ${approved ? 'text-emerald-700' : 'text-red-700'}`}>
              {notification.body}
            </p>
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
  const [activeAlert, setActiveAlert] = useState<AppNotificationRow | null>(null)

  const handleRow = useCallback(
    (row: AppNotificationRow) => {
      if (!isVerificationReviewKind(row.kind)) return
      if (seenIdsRef.current.has(row.id)) return
      seenIdsRef.current.add(row.id)

      void showForegroundVerificationNotice(row)
      setActiveAlert((prev) => prev ?? row)

      if (row.kind === 'verification_approved') onApproved?.()
      if (row.kind === 'verification_rejected') onRejected?.()
    },
    [onApproved, onRejected],
  )

  useEffect(() => {
    seenIdsRef.current.clear()
    setActiveAlert(null)
  }, [userId])

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

  const dismissAlert = useCallback(() => {
    setActiveAlert((row) => {
      if (row) void markAppNotificationRead(row.id)
      return null
    })
  }, [])

  const alertPortal = activeAlert ? (
    <VerificationReviewAlert notification={activeAlert} onDismiss={dismissAlert} />
  ) : null

  return { alertPortal }
}
