import { useEffect } from 'react'
import { subscribeWebPushForCurrentUser } from '@/lib/webPush'

/**
 * 主畫面以外的長駐畫面（身分審核等待、付費牆）也要維持推播訂閱。
 *
 * 背景：登出會刪除本裝置在 `push_subscriptions` 的訂閱列（見
 * `unsubscribeWebPushOnSignOut`）。若下一個登入的帳號停在審核／付費牆、
 * 從未進過主畫面，原本只有 MainScreen 會重建訂閱，該帳號在資料庫中
 * 就沒有任何訂閱，伺服器端推播會回報「成功 0、失敗 0」。
 */
export function useWebPushSubscriptionSync(userId: string | undefined | null): void {
  useEffect(() => {
    if (!userId) return
    if (typeof window === 'undefined' || !('Notification' in window)) return

    const run = () => {
      if (Notification.permission !== 'granted') return
      if (document.visibilityState !== 'visible') return
      void subscribeWebPushForCurrentUser(userId)
    }

    run()
    document.addEventListener('visibilitychange', run)
    window.addEventListener('pageshow', run)
    window.addEventListener('focus', run)
    return () => {
      document.removeEventListener('visibilitychange', run)
      window.removeEventListener('pageshow', run)
      window.removeEventListener('focus', run)
    }
  }, [userId])
}
