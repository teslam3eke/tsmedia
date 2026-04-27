import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Clock, CheckCircle2, XCircle, ChevronLeft,
  Cpu, Eye, RefreshCw, AlertCircle, Building2, Gem,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getAllVerifications, approveVerificationDoc,
  rejectVerificationDoc, getDocSignedUrl,
} from '@/lib/db'
import type { VerificationDocWithProfile } from '@/lib/types'

type Filter = 'pending' | 'approved' | 'rejected' | 'all'

interface Props {
  onBack: () => void
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '高信心度', medium: '中信心度', low: '低信心度',
}
const KIND_LABEL: Record<string, string> = {
  employment: '職業驗證', income: '收入認證',
}
const TIER_LABEL: Record<string, string> = {
  silver: '銀級', gold: '金級', diamond: '鑽石級',
}

export default function AdminScreen({ onBack }: Props) {
  const [filter, setFilter]     = useState<Filter>('pending')
  const [docs, setDocs]         = useState<VerificationDocWithProfile[]>([])
  const [loading, setLoading]   = useState(true)
  const [acting, setActing]     = useState<string | null>(null)   // doc id being acted on
  const [viewUrl, setViewUrl]   = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [rejectTarget, setRejectTarget] = useState<VerificationDocWithProfile | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await getAllVerifications(filter === 'all' ? undefined : filter)
    setDocs(data)
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  const handleApprove = async (doc: VerificationDocWithProfile) => {
    setActing(doc.id)
    await approveVerificationDoc(doc.id, doc)
    setActing(null)
    load()
  }

  const handleReject = async () => {
    if (!rejectTarget) return
    setActing(rejectTarget.id)
    await rejectVerificationDoc(rejectTarget.id, rejectTarget, rejectNote || undefined)
    setActing(null)
    setRejectTarget(null)
    setRejectNote('')
    load()
  }

  const handleViewDoc = async (doc: VerificationDocWithProfile) => {
    if (!doc.doc_url) return
    const url = await getDocSignedUrl(doc.doc_url)
    if (url) setViewUrl(url)
  }

  const pendingCount = docs.filter(d => filter === 'all' && d.status === 'pending').length

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-[#f5f5f7]">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-slate-100 px-5 pt-safe pb-4 z-20">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"
          >
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <div className="flex-1">
            <h1 className="text-base font-bold text-slate-900">管理後台</h1>
            <p className="text-xs text-slate-400">驗證文件審核</p>
          </div>
          <button
            onClick={load}
            className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"
          >
            <RefreshCw className={cn('w-4 h-4 text-slate-500', loading && 'animate-spin')} />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="grid grid-cols-4 gap-2">
          {(['pending', 'all', 'approved', 'rejected'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex-1 py-2 rounded-xl text-xs font-semibold transition-all',
                filter === f
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-500',
              )}
            >
              {f === 'pending' ? '待審核' : f === 'all' ? '全部' : f === 'approved' ? '已通過' : '已拒絕'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 5rem)',
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
              <Cpu className="w-6 h-6 text-slate-400" />
            </motion.div>
          </div>
        ) : docs.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-400">
              {filter === 'pending' ? '目前沒有待審核的申請' : '這裡還沒有資料'}
            </p>
          </div>
        ) : (
          <>
            {filter === 'all' && pendingCount > 0 && (
              <div className="bg-amber-50 rounded-2xl px-4 py-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-700 font-medium">{pendingCount} 件待審核</p>
              </div>
            )}
            {docs.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                acting={acting === doc.id}
                onApprove={() => handleApprove(doc)}
                onReject={() => setRejectTarget(doc)}
                onView={() => handleViewDoc(doc)}
              />
            ))}
          </>
        )}
      </div>

      {/* Document viewer overlay */}
      <AnimatePresence>
        {viewUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/90"
            onClick={() => setViewUrl(null)}
          >
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-[2] h-28 bg-gradient-to-b from-black/80 to-transparent">
              <p className="absolute left-5 top-16 text-white text-sm font-semibold">驗證文件</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setViewUrl(null)
                }}
                className="pointer-events-auto absolute right-5 top-16 min-h-12 rounded-full bg-white px-6 py-3 text-sm font-bold text-slate-900 shadow-xl ring-1 ring-white/30"
              >
                關閉
              </button>
            </div>
            <div className="flex h-full items-center justify-center px-5 py-24" onClick={(e) => e.stopPropagation()}>
              <img
                src={viewUrl}
                alt="驗證文件"
                className="max-h-[72dvh] max-w-[92vw] rounded-2xl bg-white object-contain shadow-2xl"
              />
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setViewUrl(null)
              }}
              className="absolute left-1/2 z-[3] min-h-12 -translate-x-1/2 rounded-full bg-white px-8 py-3 text-sm font-bold text-slate-900 shadow-xl ring-1 ring-black/5"
              style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
            >
              關閉預覽
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reject note modal — portal avoids transformed app shells trapping fixed positioning. */}
      {createPortal(
        <AnimatePresence>
          {rejectTarget && (
            <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
              className="fixed inset-0 z-[300] flex items-center justify-center bg-black/55 px-5"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                className="flex w-full max-w-sm max-h-[70dvh] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
              >
                <div className="flex-1 overflow-y-auto px-5 pt-6 pb-4 space-y-4">
                  <h2 className="text-base font-bold text-slate-900">拒絕申請</h2>
                  <p className="text-xs text-slate-500">
                    {rejectTarget.profiles?.name ?? rejectTarget.user_id.slice(0, 8)} 的{' '}
                    {KIND_LABEL[rejectTarget.verification_kind]}
                  </p>
                  <textarea
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="拒絕原因（選填，會記錄在審核備註中）"
                    className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 resize-none outline-none ring-1 ring-slate-100 focus:ring-slate-300 transition-all"
                    rows={4}
                  />
                </div>
                <div className="flex flex-shrink-0 gap-3 border-t border-slate-100 bg-white px-5 py-4">
                  <button
                    onClick={() => { setRejectTarget(null); setRejectNote('') }}
                    className="flex-1 py-3.5 rounded-2xl bg-slate-100 text-slate-600 text-sm font-semibold"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={acting !== null}
                    className="flex-1 py-3.5 rounded-2xl bg-red-500 text-white text-sm font-bold disabled:opacity-60"
                  >
                    確認拒絕
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

// ── Doc Card ─────────────────────────────────────────────────────────────────

interface DocCardProps {
  doc: VerificationDocWithProfile
  acting: boolean
  onApprove: () => void
  onReject: () => void
  onView: () => void
}

function DocCard({ doc, acting, onApprove, onReject, onView }: DocCardProps) {
  const name        = doc.profiles?.name ?? '未知用戶'
  const isPending   = doc.status === 'pending'
  const isApproved  = doc.status === 'approved'
  const isIncome    = doc.verification_kind === 'income'
  const hasAi       = doc.ai_passed !== null
  const needsManualReview = isPending && doc.review_mode === 'manual' && doc.ai_passed === false
  const aiTone = doc.ai_passed ? 'pass' : needsManualReview ? 'review' : 'fail'
  const aiReasonLines = [
    doc.ai_reason && `AI 判斷：${doc.ai_reason}`,
    doc.manual_review_reason && `人工覆核原因：${doc.manual_review_reason}`,
    doc.ai_confidence && `AI 信心度：${CONFIDENCE_LABEL[doc.ai_confidence]}`,
    doc.doc_type && `文件類型：${doc.doc_type === 'employee_id' ? '員工證 / 識別證' : doc.doc_type === 'tax_return' ? '扣繳憑單' : doc.doc_type === 'payslip' ? '薪資單' : doc.doc_type}`,
    needsManualReview && '處理方式：此案件不會自動通過，需要管理員人工確認後核准或拒絕。',
  ].filter(Boolean) as string[]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100 space-y-3"
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-900">{name}</span>
            <span className={cn(
              'text-[10px] font-semibold px-2 py-0.5 rounded-full',
              isPending  ? 'bg-amber-100 text-amber-700'   :
              isApproved ? 'bg-emerald-100 text-emerald-700' :
                           'bg-red-100 text-red-700',
            )}>
              {isPending ? '待審核' : isApproved ? '已通過' : '已拒絕'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {isIncome ? (
              <><Gem className="w-3 h-3 text-slate-400" />
                <span className="text-xs text-slate-500">{KIND_LABEL[doc.verification_kind]}・{TIER_LABEL[doc.claimed_income_tier ?? ''] ?? ''}</span>
              </>
            ) : (
              <><Building2 className="w-3 h-3 text-slate-400" />
                <span className="text-xs text-slate-500">{KIND_LABEL[doc.verification_kind]}・{doc.company ?? '未知公司'}</span>
              </>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            {new Date(doc.submitted_at).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {/* View doc button */}
        {doc.doc_url && (
          <button
            onClick={onView}
            className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0"
          >
            <Eye className="w-4 h-4 text-slate-500" />
          </button>
        )}
      </div>

      {/* AI result */}
      {hasAi && (
        <div className={cn(
          'rounded-xl px-3 py-2.5 flex items-start gap-2',
          aiTone === 'pass' ? 'bg-emerald-50' : aiTone === 'review' ? 'bg-amber-50' : 'bg-red-50',
        )}>
          <Cpu className={cn(
            'w-3.5 h-3.5 flex-shrink-0 mt-0.5',
            aiTone === 'pass' ? 'text-emerald-500' : aiTone === 'review' ? 'text-amber-500' : 'text-red-400',
          )} />
          <div className="flex-1 min-w-0 space-y-0.5">
            <p className={cn(
              'text-xs font-semibold',
              aiTone === 'pass' ? 'text-emerald-700' : aiTone === 'review' ? 'text-amber-700' : 'text-red-600',
            )}>
              AI 初審：{doc.ai_passed ? `✓ 通過` : needsManualReview ? '需人工覆核' : '✗ 未通過'}
              {doc.ai_company && ` · ${doc.ai_company}`}
              {doc.ai_confidence && ` · ${CONFIDENCE_LABEL[doc.ai_confidence]}`}
            </p>
            {aiReasonLines.length > 0 && (
              <div className="space-y-1 pt-0.5">
                {aiReasonLines.map((line) => (
                  <p key={line} className="text-[10px] text-slate-500 leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!hasAi && doc.verification_kind === 'employment' && (
        <div className="rounded-xl px-3 py-2 bg-slate-50 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <p className="text-[10px] text-slate-400">未經 AI 初審（PDF 文件或舊申請）</p>
        </div>
      )}

      {/* Reviewer note */}
      {doc.reviewer_note && (
        <div className="rounded-xl px-3 py-2 bg-slate-50">
          <p className="text-[10px] text-slate-400">審核備註：{doc.reviewer_note}</p>
        </div>
      )}

      {/* Action buttons */}
      {isPending && (
        <div className="relative z-[1] grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
          <button
            onClick={onReject}
            disabled={acting}
            className="py-2.5 rounded-xl bg-red-50 text-red-500 text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-60"
          >
            <XCircle className="w-3.5 h-3.5" />
            拒絕
          </button>
          <button
            onClick={onApprove}
            disabled={acting}
            className="py-2.5 rounded-xl bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-60"
          >
            {acting ? (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}>
                <Cpu className="w-3.5 h-3.5" />
              </motion.div>
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            核准通過
          </button>
        </div>
      )}

      {isApproved && (
        <div className="flex items-center gap-2 pt-1">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <p className="text-xs text-emerald-600 font-medium">
            已核准・{doc.reviewed_at ? new Date(doc.reviewed_at).toLocaleDateString('zh-TW') : ''}
          </p>
        </div>
      )}

      {!isPending && !isApproved && (
        <div className="flex items-center gap-2 pt-1">
          <XCircle className="w-4 h-4 text-red-400" />
          <p className="text-xs text-red-500 font-medium">
            已拒絕・{doc.reviewed_at ? new Date(doc.reviewed_at).toLocaleDateString('zh-TW') : ''}
          </p>
        </div>
      )}
    </motion.div>
  )
}

// suppress unused import warnings for icons used conditionally
void Clock
