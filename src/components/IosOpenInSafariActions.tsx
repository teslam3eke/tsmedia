import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Compass, Copy } from 'lucide-react'
import {
  canAttemptIosSafariHandoff,
  copyUrlForSafariFallback,
  resolveTsMediaOpenUrl,
  tryOpenUrlInIosSafari,
} from '@/lib/iosSafariOpen'

interface Props {
  /** 預設為目前網址；確認信引導可傳完整 callback URL */
  url?: string
  /** 主按鈕文案 */
  tryLabel?: string
  className?: string
}

/**
 * iOS Chrome 等：嘗試 `x-safari-https://` 交給 Safari，並一併複製 https 備援。
 */
export default function IosOpenInSafariActions({
  url,
  tryLabel = '嘗試用 Safari 開啟',
  className,
}: Props) {
  const httpsUrl = resolveTsMediaOpenUrl(url)
  const [copied, setCopied] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  if (!canAttemptIosSafariHandoff()) return null

  const handleTrySafari = async () => {
    setHint(null)
    const didCopy = await copyUrlForSafariFallback(httpsUrl)
    if (didCopy) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }

    const result = tryOpenUrlInIosSafari(httpsUrl)
    if (result.ok) {
      setHint('若未自動跳轉 Safari，請開啟 Safari 並貼上已複製的連結。')
    } else {
      setHint('無法自動跳轉，請複製連結後在 Safari 貼上前往。')
    }
  }

  const handleCopyOnly = async () => {
    const ok = await copyUrlForSafariFallback(httpsUrl)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  return (
    <div className={className}>
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => void handleTrySafari()}
        className="w-full rounded-2xl bg-[#007AFF] py-3.5 text-sm font-bold text-white shadow-md flex items-center justify-center gap-2"
      >
        <Compass className="w-4 h-4" aria-hidden />
        {tryLabel}
      </motion.button>

      <button
        type="button"
        onClick={() => void handleCopyOnly()}
        className="mt-2 w-full rounded-2xl bg-white py-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 flex items-center justify-center gap-2"
      >
        {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
        {copied ? '已複製網址' : '僅複製網址（到 Safari 貼上）'}
      </button>

      {hint ? (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}
