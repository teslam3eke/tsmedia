import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { cn } from '@/lib/utils'
import { maybeSubscribeWebPushAfterTermsAccept } from '@/lib/webPush'

/** 身分審核等待頁：提醒開啟通知以配合審核通過後折扣推播。 */
export function VerifyWaitNotificationCard({
  userId,
  className,
}: {
  userId?: string | null
  className?: string
}) {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported',
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const sync = () => {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        setPermission('unsupported')
        return
      }
      setPermission(Notification.permission)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  if (permission === 'granted' || permission === 'unsupported') return null

  const onEnable = async () => {
    if (!userId?.trim() || busy) return
    setBusy(true)
    try {
      await maybeSubscribeWebPushAfterTermsAccept(userId)
    } finally {
      setBusy(false)
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPermission(Notification.permission)
      }
    }
  }

  return (
    <div className={cn('rounded-2xl bg-white p-4 text-left ring-1 ring-slate-200 shadow-sm', className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900">
          <BellRing className="h-5 w-5 text-white" aria-hidden />
        </div>
        <p className="pt-0.5 text-[13px] leading-relaxed text-slate-600">
          若在審核通過時，您有保持通知開啟，
          <br />
          即可獲得相關折扣（配合全站活動）
        </p>
      </div>
      <button
        type="button"
        onClick={() => void onEnable()}
        disabled={busy}
        className="mx-auto mt-3 block w-[35%] min-w-[5.95rem] rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? '處理中' : '開啟通知'}
      </button>
    </div>
  )
}
