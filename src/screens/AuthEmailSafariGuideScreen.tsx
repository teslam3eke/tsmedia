import { useMemo } from 'react'
import { AlertCircle, Compass, ExternalLink, Mail } from 'lucide-react'
import {
  clearIosDeferredAuthCallbackUrl,
  readIosDeferredAuthCallbackUrl,
} from '@/lib/auth'
import IosOpenInSafariActions from '@/components/IosOpenInSafariActions'

interface Props {
  /** 換券失敗（可能已消耗 code）時顯示備援登入提示 */
  exchangeFailed?: boolean
  onGoSignIn: () => void
}

export default function AuthEmailSafariGuideScreen({ exchangeFailed, onGoSignIn }: Props) {
  const callbackUrl = useMemo(
    () => readIosDeferredAuthCallbackUrl() ?? (typeof window !== 'undefined' ? window.location.href : ''),
    [],
  )

  const handleGoSignIn = () => {
    clearIosDeferredAuthCallbackUrl()
    onGoSignIn()
  }

  return (
    <div className="min-h-dvh bg-[#f8fafc] flex flex-col px-5 pt-safe pb-safe">
      <div className="max-w-md mx-auto w-full flex-1 flex flex-col py-8">
        <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-5">
          <Compass className="w-7 h-7 text-amber-700" aria-hidden />
        </div>
        <h1 className="text-2xl font-black text-slate-950 tracking-[-0.03em]">
          請用 Safari 開啟確認連結
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          iPhone 無法從 Email 強制指定瀏覽器。若連結在 Chrome 等 App 開啟，信箱驗證常會失敗。
          請改在 <span className="font-semibold text-slate-900">Safari</span> 貼上同一連結完成驗證。
        </p>

        {exchangeFailed ? (
          <div className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              此連結可能已無法再次使用。若你已收到確認成功通知，可直接登入；否則請回到註冊流程重新寄送確認信。
            </span>
          </div>
        ) : null}

        <ol className="mt-6 space-y-3 text-sm text-slate-700">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">1</span>
            <span>點下方「嘗試用 Safari 開啟」或複製連結</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">2</span>
            <span>在 Safari 完成驗證（或從主畫面 tsMedia 圖示開啟後貼上）</span>
          </li>
        </ol>

        <IosOpenInSafariActions
          url={callbackUrl}
          className="mt-6"
          tryLabel="嘗試用 Safari 開啟確認連結"
        />

        <p className="mt-3 text-[11px] text-slate-400 break-all leading-relaxed">
          {callbackUrl}
        </p>

        <div className="mt-auto pt-8 space-y-3">
          <button
            type="button"
            onClick={handleGoSignIn}
            className="w-full rounded-2xl bg-white py-3.5 text-sm font-bold text-slate-800 ring-1 ring-slate-200 flex items-center justify-center gap-2"
          >
            <Mail className="w-4 h-4" />
            已完成確認，前往登入
          </button>
          <p className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1">
            <ExternalLink className="w-3 h-3" />
            可在「設定 → App → 預設瀏覽器 App」改回 Safari，減少連結誤開 Chrome
          </p>
        </div>
      </div>
    </div>
  )
}
