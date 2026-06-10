import { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { MessageSquare, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { USER_FEEDBACK_CATEGORIES, type UserFeedbackCategory } from '@/lib/userFeedback'
import { submitUserFeedback } from '@/lib/db'

interface Props {
  onClose: () => void
}

export default function FeedbackScreen({ onClose }: Props) {
  const [step, setStep] = useState<'category' | 'body'>('category')
  const [category, setCategory] = useState<UserFeedbackCategory | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const selectedCategory = USER_FEEDBACK_CATEGORIES.find((item) => item.value === category)

  const submit = async () => {
    if (!category) return
    setBusy(true)
    setStatus(null)
    try {
      const result = await submitUserFeedback(category, body)
      if (!result.ok) {
        setStatus({ type: 'error', message: result.error ?? '送出失敗，請稍後再試。' })
        return
      }
      setStatus({ type: 'success', message: '已收到你的意見，感謝協助我們改善。' })
      window.setTimeout(onClose, 900)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[230] flex flex-col bg-[#f5f5f7]"
    >
      <div className="flex-shrink-0 bg-white border-b border-slate-100 px-5 pt-safe pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (step === 'body') {
                setStep('category')
                setStatus(null)
                return
              }
              onClose()
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100"
          >
            <ChevronLeft className="h-4 w-4 text-slate-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-slate-900">意見反映</h1>
            <p className="text-xs text-slate-400">
              {step === 'category' ? '請選擇反映類型' : selectedCategory?.label ?? '填寫內容'}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900">
            <MessageSquare className="h-5 w-5 text-white" />
          </div>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4"
        style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(env(safe-area-inset-bottom) + 6rem)' }}
      >
        {step === 'category' ? (
          <div className="space-y-2">
            {USER_FEEDBACK_CATEGORIES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setCategory(item.value)
                  setStep('body')
                  setStatus(null)
                }}
                className="w-full rounded-2xl bg-white px-4 py-3.5 text-left shadow-sm ring-1 ring-slate-100 transition-all active:scale-[0.99]"
              >
                <span className="block text-sm font-bold text-slate-900">{item.label}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-400">{item.desc}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
            {selectedCategory && (
              <div className="mb-4 rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-bold text-slate-400">反映類型</p>
                <p className="mt-0.5 text-sm font-bold text-slate-900">{selectedCategory.label}</p>
              </div>
            )}

            <label className="block">
              <span className="text-xs font-bold tracking-[0.18em] text-slate-400 uppercase">詳細內容</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="請描述你遇到的狀況或建議，至少 10 個字。"
                className="mt-2 w-full resize-none rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none ring-1 ring-slate-100 placeholder:text-slate-300 focus:ring-slate-300"
              />
            </label>
            <p className="mt-2 text-[10px] text-slate-400">{body.trim().length} / 2000 字</p>

            {status && (
              <div className={cn(
                'mt-3 rounded-2xl px-3 py-2 text-xs font-semibold',
                status.type === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600',
              )}>
                {status.message}
              </div>
            )}
          </div>
        )}
      </div>

      {step === 'body' && (
        <div
          className="flex-shrink-0 border-t border-slate-100 bg-white px-4 py-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            type="button"
            onClick={submit}
            disabled={busy || body.trim().length < 10}
            className="w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? '送出中…' : '送出意見'}
          </button>
        </div>
      )}
    </motion.div>,
    document.body,
  )
}
