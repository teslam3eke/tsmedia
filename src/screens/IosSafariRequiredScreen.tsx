import { useMemo } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { readIosDeferredAuthCallbackUrl } from '@/lib/auth'
import IosOpenInSafariActions from '@/components/IosOpenInSafariActions'

interface Props {
  /** PKCE 換券失敗（連結可能已失效） */
  exchangeFailed?: boolean
}

/**
 * iOS Chrome 等：全螢幕閘門，無法略過進入註冊／主畫面等流程。
 * 僅能嘗試跳轉 Safari 或複製網址後在 Safari 開啟。
 */
export default function IosSafariRequiredScreen({ exchangeFailed }: Props) {
  const openUrl = useMemo(
    () => readIosDeferredAuthCallbackUrl() ?? (typeof window !== 'undefined' ? window.location.href : ''),
    [],
  )
  const isAuthCallback = Boolean(openUrl && /[?&]code=/.test(openUrl))

  return (
    <div className="min-h-dvh bg-[#f8fafc] flex flex-col px-5 pt-safe pb-safe">
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col py-8">
        <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-5">
          <AlertTriangle className="w-7 h-7 text-amber-700" aria-hidden />
        </div>
        <h1 className="text-2xl font-black text-slate-950 tracking-[-0.03em]">
          {isAuthCallback ? '請用 Safari 完成信箱驗證' : '請改用 Safari 使用 tsMedia'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          偵測到你正在使用 Chrome（或其他非 Safari 瀏覽器）。在 iPhone 上無法繼續下一步，請改以
          <span className="font-semibold text-slate-900"> Safari </span>
          或從主畫面 tsMedia 圖示開啟。
        </p>

        {exchangeFailed ? (
          <div className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              此確認連結可能已無法再次使用。若信箱已確認，請在 Safari 開啟本站並登入；否則請重新寄送確認信。
            </span>
          </div>
        ) : null}

        <ol className="mt-6 space-y-3 text-sm text-slate-700">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">1</span>
            <span>點下方「嘗試用 Safari 開啟」</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">2</span>
            <span>若未跳轉，請在 Safari 貼上已複製的網址</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">3</span>
            <span>建議 Safari「加入主畫面」，之後從圖示進入</span>
          </li>
        </ol>

        <IosOpenInSafariActions
          url={openUrl}
          className="mt-6"
          tryLabel={isAuthCallback ? '嘗試用 Safari 開啟確認連結' : '嘗試用 Safari 開啟 tsMedia'}
        />

        <p className="mt-3 text-[11px] text-slate-400 break-all leading-relaxed">{openUrl}</p>

        <p className="mt-auto pt-8 text-center text-[11px] text-slate-400 leading-relaxed">
          可在「設定 → App → 預設瀏覽器 App」改回 Safari，避免連結誤開 Chrome。
        </p>
      </div>
    </div>
  )
}
