import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, ShieldCheck, X } from 'lucide-react'
import { TERMS_VERSION } from '@/lib/db'
import { TERMS_SECTIONS } from '@/lib/termsContent'

export default function TermsOfServiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[500] flex flex-col bg-[#f8fafc]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terms-of-service-title"
        >
          <header className="flex-shrink-0 border-b border-slate-100 bg-white px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 shadow-lg shadow-slate-900/20">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Terms of Service</p>
                <h2 id="terms-of-service-title" className="text-lg font-black tracking-tight text-slate-950">
                  會員同意書
                </h2>
                <p className="mt-1 text-xs text-slate-500">版本 {TERMS_VERSION}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 active:bg-slate-200"
                aria-label="關閉"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
            {TERMS_SECTIONS.map((section) => (
              <section key={section.title} className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
                <h3 className="text-sm font-black text-slate-900">{section.title}</h3>
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

          <div
            className="flex-shrink-0 border-t border-slate-100 bg-white px-4 pt-3"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-bold text-white shadow-lg shadow-slate-900/15"
            >
              關閉
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
