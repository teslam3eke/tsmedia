import { useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, Check, FileText, ShieldCheck } from 'lucide-react'
import { TERMS_VERSION } from '@/lib/db'
import { TERMS_SECTIONS } from '@/lib/termsContent'

interface Props {
  busy?: boolean
  error?: string
  onAccept: () => void
  onBack?: () => void
}

export default function TermsConsentScreen({ busy = false, error, onAccept, onBack }: Props) {
  const [checked, setChecked] = useState(false)

  return (
    <div className="min-h-dvh bg-[#f8fafc] flex flex-col">
      <div className="px-5 pt-8 pb-4 bg-white border-b border-slate-100">
        <div className="w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center mb-4 shadow-lg shadow-slate-900/20">
          <FileText className="w-7 h-7 text-white" />
        </div>
        <p className="text-xs font-bold tracking-[0.22em] text-slate-400 uppercase">TsMedia Agreement</p>
        <h1 className="mt-1 text-2xl font-black tracking-[-0.04em] text-slate-950">會員同意書</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          使用前請閱讀並同意以下條款。版本：{TERMS_VERSION}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
        {TERMS_SECTIONS.map((section) => (
          <section key={section.title} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <h2 className="text-sm font-black text-slate-900">{section.title}</h2>
            <div className="mt-3 space-y-2.5">
              {section.items.map((item) => (
                <div key={item} className="flex items-start gap-2.5">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-300" />
                  <p className="text-[12px] leading-relaxed text-slate-600">{item}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="bg-white px-5 pt-4 border-t border-slate-100" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-2xl bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setChecked((value) => !value)}
          className="flex w-full items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-left"
        >
          <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${checked ? 'border-slate-900 bg-slate-900' : 'border-slate-300 bg-white'}`}>
            {checked && <Check className="h-3.5 w-3.5 text-white" />}
          </span>
          <span className="text-xs leading-relaxed text-slate-600">
            我已年滿 18 歲，並已完整閱讀、理解且同意上述會員同意書與平台規範。
          </span>
        </button>
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={onAccept}
          disabled={!checked || busy}
          className="mt-3 w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-bold text-white shadow-lg shadow-slate-900/15 disabled:opacity-40"
        >
          {busy ? '儲存同意紀錄中' : '同意並繼續'}
        </motion.button>
        {onBack && (
          <button onClick={onBack} className="mt-2 w-full py-2.5 text-xs font-semibold text-slate-400">
            返回
          </button>
        )}
      </div>
    </div>
  )
}
