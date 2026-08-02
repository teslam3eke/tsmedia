import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Clock, CheckCircle2, XCircle, ChevronLeft,
  Eye, RefreshCw, AlertCircle, Flag, Ban, MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { userFeedbackCategoryLabel } from '@/lib/userFeedback'
import {
  getAllVerificationApplications, approveVerificationApplication,
  rejectVerificationApplication, getDocSignedUrl, resolvePhotoUrls, getAdminProfileReports,
  getAdminMessageReports, updateProfileReportStatus, updateMessageReportStatus,
  getAdminUserFeedback, updateUserFeedbackStatus,
  blockProfile,
} from '@/lib/db'
import AdminPricingTab from '@/screens/AdminPricingTab'
import type {
  MessageReportRow, ProfileReportRow, UserFeedbackWithProfile,
  VerificationApplicationWithProfile, VerificationDocRow,
} from '@/lib/types'
import { INCOME_TIER_META, VERIFICATION_MANUAL_SLA_HOURS } from '@/lib/types'
import {
  ADMIN_VERIFICATION_REJECT_PRESETS,
  buildAdminVerificationRejectNote,
} from '@/lib/adminVerificationRejectReasons'

type Filter = 'pending' | 'approved' | 'rejected' | 'all'
type AdminTab = 'verifications' | 'reports' | 'feedback' | 'pricing'

interface Props {
  onBack: () => void
}

const DOC_TYPE_LABEL: Record<string, string> = {
  national_id: '身分證',
  passport: '護照',
  driver_license: '駕照',
  employee_id: '員工證／識別證',
  tax_return: '扣繳憑單',
  payslip: '薪資單',
  bank_statement: '銀行對帳',
  other: '其他',
}
const KIND_LABEL: Record<string, string> = {
  identity: '身分認證',
  bonus: '任職加分或其他證明',
  income: '收入皇冠',
  employment: '職業驗證（舊）',
}

export default function AdminScreen({ onBack }: Props) {
  const [tab, setTab]           = useState<AdminTab>('verifications')
  const [filter, setFilter]     = useState<Filter>('pending')
  const [applications, setApplications] = useState<VerificationApplicationWithProfile[]>([])
  const [photoPreviewMap, setPhotoPreviewMap] = useState<Record<string, string[]>>({})
  const [profileReports, setProfileReports] = useState<ProfileReportRow[]>([])
  const [messageReports, setMessageReports] = useState<MessageReportRow[]>([])
  const [feedbackItems, setFeedbackItems] = useState<UserFeedbackWithProfile[]>([])
  const [loading, setLoading]   = useState(true)
  const [acting, setActing]     = useState<string | null>(null)
  const [viewUrl, setViewUrl]   = useState<string | null>(null)
  const [viewKind, setViewKind] = useState<'image' | 'pdf' | null>(null)
  const [rejectPresetId, setRejectPresetId] = useState<string | null>(null)
  const [rejectExtraNote, setRejectExtraNote] = useState('')
  const [rejectError, setRejectError] = useState('')
  const [rejectTarget, setRejectTarget] = useState<VerificationApplicationWithProfile | null>(null)

  const rejectPresetsByCategory = useMemo(() => {
    const map = new Map<string, typeof ADMIN_VERIFICATION_REJECT_PRESETS>()
    for (const preset of ADMIN_VERIFICATION_REJECT_PRESETS) {
      const list = map.get(preset.category) ?? []
      list.push(preset)
      map.set(preset.category, list)
    }
    return [...map.entries()]
  }, [])

  const selectedRejectPreset = useMemo(
    () => ADMIN_VERIFICATION_REJECT_PRESETS.find((p) => p.id === rejectPresetId) ?? null,
    [rejectPresetId],
  )

  const clearRejectModal = () => {
    setRejectTarget(null)
    setRejectPresetId(null)
    setRejectExtraNote('')
    setRejectError('')
  }

  const load = useCallback(async () => {
    setLoading(true)
    if (tab === 'verifications') {
      const data = await getAllVerificationApplications(filter === 'all' ? 'all' : filter)
      setApplications(data)
      const userIds = [...new Set(data.map((a) => a.user_id))]
      const entries = await Promise.all(
        userIds.map(async (uid) => {
          const app = data.find((a) => a.user_id === uid)
          const paths = app?.profiles?.photo_urls?.filter(Boolean) ?? []
          if (paths.length === 0) return [uid, []] as const
          const urls = await resolvePhotoUrls(paths)
          return [uid, urls.filter(Boolean)] as const
        }),
      )
      setPhotoPreviewMap(Object.fromEntries(entries))
    } else if (tab === 'reports') {
      const [profileData, messageData] = await Promise.all([
        getAdminProfileReports(),
        getAdminMessageReports(),
      ])
      setProfileReports(profileData)
      setMessageReports(messageData)
    } else if (tab === 'feedback') {
      const data = await getAdminUserFeedback()
      setFeedbackItems(data)
    }
    setLoading(false)
  }, [filter, tab])

  useEffect(() => { load() }, [load])

  const reportVerificationPushResult = (result: {
    ok: boolean
    error?: string
    pushSent?: number
    pushFailed?: number
  }) => {
    if (!result.ok) {
      window.alert(`審核資料未完成更新：${result.error ?? '未知錯誤'}`)
      return
    }
    if ((result.pushSent ?? 0) > 0) return
    window.alert(
      `審核已更新，但推播未確認送達（成功 ${result.pushSent ?? 0}、失敗 ${result.pushFailed ?? 0}）。\n${result.error ?? '請將這段訊息截圖回報，勿視為通知已送出。'}`,
    )
  }

  const handleApprove = async (app: VerificationApplicationWithProfile) => {
    setActing(app.id)
    const result = await approveVerificationApplication(app.id, app)
    setActing(null)
    reportVerificationPushResult(result)
    load()
  }

  const handleApproveWithoutIncome = async (app: VerificationApplicationWithProfile) => {
    setActing(app.id)
    const result = await approveVerificationApplication(app.id, app, { skipIncome: true })
    setActing(null)
    reportVerificationPushResult(result)
    load()
  }

  const handleReject = async () => {
    if (!rejectTarget) return
    const built = buildAdminVerificationRejectNote(rejectPresetId, rejectExtraNote)
    if (!built.ok) {
      setRejectError(built.error)
      return
    }
    setRejectError('')
    setActing(rejectTarget.id)
    const result = await rejectVerificationApplication(rejectTarget.id, rejectTarget, built.note)
    setActing(null)
    clearRejectModal()
    reportVerificationPushResult(result)
    load()
  }

  const handleViewDoc = async (doc: VerificationDocRow) => {
    if (!doc.doc_url) return
    const lower = doc.doc_url.split('?')[0].toLowerCase()
    const isPdf = lower.endsWith('.pdf')
    const url = await getDocSignedUrl(doc.doc_url)
    if (!url) {
      window.alert(
        '無法載入驗證文件（簽名連結失敗）。若您為管理員，請確認已在資料庫套用 Storage 政策「proofs: admin select all」（見 supabase/migrations/040_storage_proofs_admin_select.sql）。',
      )
      return
    }
    setViewKind(isPdf ? 'pdf' : 'image')
    setViewUrl(url)
  }

  const closeViewer = () => {
    setViewUrl(null)
    setViewKind(null)
  }

  const pendingCount = applications.filter(a => filter === 'all' && a.status === 'pending').length
  const openReportCount = [...profileReports, ...messageReports].filter((r) => r.status === 'open' || r.status === 'reviewing').length
  const openFeedbackCount = feedbackItems.filter((r) => r.status === 'open' || r.status === 'reviewing').length

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
            <p className="text-xs text-slate-400">驗證文件 / 檢舉 / 意見 / 定價</p>
          </div>
          <button
            onClick={load}
            className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"
          >
            <RefreshCw className={cn('w-4 h-4 text-slate-500', loading && 'animate-spin')} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2">
          {([
            ['verifications', '驗證審核'],
            ['reports', `檢舉${openReportCount ? ` ${openReportCount}` : ''}`],
            ['feedback', `意見${openFeedbackCount ? ` ${openFeedbackCount}` : ''}`],
            ['pricing', '付費特價'],
          ] as [AdminTab, string][]).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                'py-2 rounded-xl text-xs font-bold transition-all',
                tab === value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'verifications' && (
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
        )}
      </div>

      {/* List */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 5rem)',
        }}
      >
        {loading && tab !== 'pricing' ? (
          <div className="flex items-center justify-center py-16">
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
              <RefreshCw className={cn('w-6 h-6 text-slate-400', loading && 'animate-spin')} />
            </motion.div>
          </div>
        ) : tab === 'verifications' && applications.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-400">
              {filter === 'pending' ? '目前沒有待審核的申請' : '這裡還沒有資料'}
            </p>
          </div>
        ) : tab === 'verifications' ? (
          <>
            {filter === 'all' && pendingCount > 0 && (
              <div className="bg-amber-50 rounded-2xl px-4 py-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <p className="text-xs text-amber-700 font-medium">{pendingCount} 件待審核</p>
              </div>
            )}
            {applications.map((app) => (
              <ApplicationCard
                key={app.id}
                app={app}
                photoUrls={photoPreviewMap[app.user_id] ?? []}
                acting={acting === app.id}
                onApprove={() => handleApprove(app)}
                onApproveWithoutIncome={() => handleApproveWithoutIncome(app)}
                onReject={() => setRejectTarget(app)}
                onViewDoc={(doc) => void handleViewDoc(doc)}
              />
            ))}
          </>
        ) : tab === 'reports' ? (
          <ReportAdminList
            profileReports={profileReports}
            messageReports={messageReports}
            acting={acting}
            onResolveProfile={async (report, status) => {
              setActing(report.id)
              await updateProfileReportStatus(report.id, status)
              setActing(null)
              load()
            }}
            onResolveMessage={async (report, status) => {
              setActing(report.id)
              await updateMessageReportStatus(report.id, status)
              setActing(null)
              load()
            }}
            onBlock={async (target) => {
              setActing(target.key)
              await blockProfile({
                blockedProfileKey: target.profileKey,
                blockedUserId: target.userId ?? null,
                blockedDisplayName: target.displayName ?? null,
                reason: 'admin_report_action',
              })
              setActing(null)
              load()
            }}
          />
        ) : tab === 'pricing' ? (
          <AdminPricingTab />
        ) : (
          <FeedbackAdminList
            items={feedbackItems}
            acting={acting}
            onResolve={async (item, status) => {
              setActing(item.id)
              await updateUserFeedbackStatus(item.id, status)
              setActing(null)
              load()
            }}
          />
        )}
      </div>

      {/* Document viewer overlay */}
      <AnimatePresence>
        {viewUrl && viewKind && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/90"
            onClick={closeViewer}
          >
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-[2] h-28 bg-gradient-to-b from-black/80 to-transparent">
              <p className="absolute left-5 top-16 text-white text-sm font-semibold">
                驗證文件{viewKind === 'pdf' ? '（PDF）' : ''}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  closeViewer()
                }}
                className="pointer-events-auto absolute right-5 top-16 min-h-12 rounded-full bg-white px-6 py-3 text-sm font-bold text-slate-900 shadow-xl ring-1 ring-white/30"
              >
                關閉
              </button>
            </div>
            <div className="flex h-full items-center justify-center px-5 py-24" onClick={(e) => e.stopPropagation()}>
              {viewKind === 'pdf' ? (
                <iframe
                  title="驗證文件 PDF"
                  src={viewUrl}
                  className="h-[72dvh] w-[92vw] max-w-3xl rounded-2xl bg-white shadow-2xl"
                />
              ) : (
                <img
                  src={viewUrl}
                  alt="驗證文件"
                  className="max-h-[72dvh] max-w-[92vw] rounded-2xl bg-white object-contain shadow-2xl"
                />
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                closeViewer()
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
                className="flex w-full max-w-md max-h-[85dvh] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
              >
                <div className="flex-1 overflow-y-auto px-5 pt-6 pb-4 space-y-4">
                  <h2 className="text-base font-bold text-slate-900">拒絕申請</h2>
                  <p className="text-xs text-slate-500">
                    {rejectTarget.profiles?.name ?? rejectTarget.user_id.slice(0, 8)} 的會員審核申請
                  </p>
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-slate-600">選擇拒絕理由</p>
                    {rejectPresetsByCategory.map(([category, presets]) => (
                      <div key={category} className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{category}</p>
                        <div className="flex flex-wrap gap-2">
                          {presets.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setRejectPresetId(preset.id)
                                setRejectError('')
                              }}
                              className={cn(
                                'rounded-full px-3 py-1.5 text-xs font-semibold transition-all ring-1',
                                rejectPresetId === preset.id
                                  ? 'bg-red-50 text-red-700 ring-red-200'
                                  : 'bg-slate-50 text-slate-600 ring-slate-100 hover:bg-slate-100',
                              )}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {selectedRejectPreset && !selectedRejectPreset.requiresExtra && selectedRejectPreset.message && (
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 mb-1">申請者將收到</p>
                      <p className="text-xs leading-relaxed text-slate-700">{selectedRejectPreset.message}</p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-600">
                      {selectedRejectPreset?.requiresExtra ? '補充說明（必填）' : '補充說明（選填）'}
                    </p>
                    <textarea
                      value={rejectExtraNote}
                      onChange={(e) => {
                        setRejectExtraNote(e.target.value)
                        setRejectError('')
                      }}
                      placeholder={
                        selectedRejectPreset?.requiresExtra
                          ? '請填寫拒絕原因，會通知申請者'
                          : '可補充一句說明，會附加在預設理由後'
                      }
                      className="w-full rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 resize-none outline-none ring-1 ring-slate-100 focus:ring-slate-300 transition-all"
                      rows={3}
                    />
                  </div>
                  {rejectError && (
                    <p className="text-xs font-semibold text-red-600">{rejectError}</p>
                  )}
                </div>
                <div className="flex flex-shrink-0 gap-3 border-t border-slate-100 bg-white px-5 py-4">
                  <button
                    onClick={clearRejectModal}
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

// ── Application Card（整包審核）──────────────────────────────────────────────

function slaLabel(submittedAt: string): string {
  const submitted = new Date(submittedAt).getTime()
  const deadline = submitted + VERIFICATION_MANUAL_SLA_HOURS * 60 * 60 * 1000
  const remainMs = deadline - Date.now()
  if (remainMs <= 0) return '已逾 12 小時 SLA'
  const hours = Math.floor(remainMs / (60 * 60 * 1000))
  const mins = Math.floor((remainMs % (60 * 60 * 1000)) / (60 * 1000))
  return `距 SLA 約 ${hours} 小時 ${mins} 分`
}

interface ApplicationCardProps {
  app: VerificationApplicationWithProfile
  photoUrls: string[]
  acting: boolean
  onApprove: () => void
  onApproveWithoutIncome: () => void
  onReject: () => void
  onViewDoc: (doc: VerificationDocRow) => void
}

function ApplicationCard({ app, photoUrls, acting, onApprove, onApproveWithoutIncome, onReject, onViewDoc }: ApplicationCardProps) {
  const p = app.profiles
  const name = p?.name ?? '未知用戶'
  const isPending = app.status === 'pending'
  const isApproved = app.status === 'approved'
  const hasIncomeDoc = app.docs.some((d) => d.verification_kind === 'income')
  const genderLabel = p?.gender === 'female' ? '女' : p?.gender === 'male' ? '男' : '—'
  const questionnaire = Array.isArray(p?.questionnaire) ? p!.questionnaire!.slice(0, 3) : []

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-900">{name}</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{genderLabel}</span>
            <span className={cn(
              'text-[10px] font-semibold px-2 py-0.5 rounded-full',
              isPending ? 'bg-amber-100 text-amber-700' : isApproved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
            )}>
              {isPending ? '待審核' : isApproved ? '已通過' : '已拒絕'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {p?.company?.trim() || '—'}{p?.job_title?.trim() ? ` · ${p.job_title.trim()}` : ''}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">
            送出 {new Date(app.submitted_at).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {isPending ? ` · ${slaLabel(app.submitted_at)}` : ''}
          </p>
        </div>
      </div>

      {photoUrls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photoUrls.map((url) => (
            <img key={url} src={url} alt="生活照" className="w-16 h-16 rounded-xl object-cover flex-shrink-0 bg-slate-100" />
          ))}
        </div>
      )}

      {p?.bio?.trim() && (
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-semibold text-slate-400 mb-1">自傳</p>
          <p className="text-xs text-slate-600 leading-relaxed line-clamp-4">{p.bio.trim()}</p>
        </div>
      )}

      {questionnaire.length > 0 && (
        <div className="rounded-xl bg-slate-50 px-3 py-2 space-y-1.5">
          <p className="text-[10px] font-semibold text-slate-400">問卷摘要</p>
          {questionnaire.map((q) => (
            <p key={q.id} className="text-[10px] text-slate-500 leading-relaxed">
              <span className="font-semibold text-slate-600">{q.category}：</span>
              {(q.answer ?? '').slice(0, 80)}{(q.answer?.length ?? 0) > 80 ? '…' : ''}
            </p>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {app.docs.length === 0 && (
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-[10px] text-slate-400">未附加任職或收入文件，請依會員資料與生活照進行人工審核。</p>
          </div>
        )}
        {app.docs.map((doc) => (
          <div key={doc.id} className="flex items-center justify-between gap-2 rounded-xl ring-1 ring-slate-100 px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800">
                {KIND_LABEL[doc.verification_kind] ?? doc.verification_kind}
                {doc.doc_type && doc.doc_type !== 'other'
                  ? ` · ${DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type}`
                  : ''}
              </p>
              {doc.verification_kind === 'income' && doc.claimed_income_tier && (
                <p className="text-[10px] text-slate-400">
                  {INCOME_TIER_META[doc.claimed_income_tier]?.label ?? doc.claimed_income_tier}
                </p>
              )}
            </div>
            {doc.doc_url ? (
              <button
                type="button"
                onClick={() => onViewDoc(doc)}
                className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0"
              >
                <Eye className="w-4 h-4 text-slate-500" />
              </button>
            ) : (
              <span className="text-[10px] text-slate-300">已刪除</span>
            )}
          </div>
        ))}
      </div>

      {app.reviewer_note && (
        <div className="rounded-xl px-3 py-2 bg-slate-50">
          <p className="text-[10px] text-slate-400">審核備註：{app.reviewer_note}</p>
        </div>
      )}

      {isPending && (
        <div className="relative z-[1] space-y-2 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onReject}
              disabled={acting}
              className="py-2.5 rounded-xl bg-red-50 text-red-500 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <XCircle className="w-3.5 h-3.5" />
              整包拒絕
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={acting}
              className="py-2.5 rounded-xl bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {acting ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </motion.div>
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              整包通過
            </button>
          </div>
          {hasIncomeDoc ? (
            <button
              type="button"
              onClick={onApproveWithoutIncome}
              disabled={acting}
              className="w-full py-2.5 rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              通過（不含收入皇冠）
            </button>
          ) : null}
        </div>
      )}
    </motion.div>
  )
}

function reportReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    fake_profile: '假帳號 / 盜用照片',
    married_or_not_single: '已婚或非單身',
    harassment: '騷擾或不當訊息',
    scam_or_sales: '詐騙 / 推銷',
    inappropriate_content: '不當內容',
    privacy_violation: '侵犯隱私',
    other: '其他',
  }
  return labels[reason] ?? reason
}

function ReportAdminList({
  profileReports,
  messageReports,
  acting,
  onResolveProfile,
  onResolveMessage,
  onBlock,
}: {
  profileReports: ProfileReportRow[]
  messageReports: MessageReportRow[]
  acting: string | null
  onResolveProfile: (report: ProfileReportRow, status: 'resolved' | 'dismissed') => void
  onResolveMessage: (report: MessageReportRow, status: 'resolved' | 'dismissed') => void
  onBlock: (target: { key: string; profileKey: string; userId?: string | null; displayName?: string | null }) => void
}) {
  const hasReports = profileReports.length > 0 || messageReports.length > 0
  if (!hasReports) {
    return (
      <div className="text-center py-16">
        <Flag className="w-10 h-10 text-slate-200 mx-auto mb-3" />
        <p className="text-sm text-slate-400">目前沒有檢舉案件</p>
      </div>
    )
  }

  return (
    <>
      {profileReports.map((report) => (
        <ReportCard
          key={`profile-${report.id}`}
          title={report.reported_display_name ?? report.reported_profile_key}
          subtitle="用戶檢舉"
          reason={report.reason}
          details={report.details}
          status={report.status}
          createdAt={report.created_at}
          acting={acting === report.id || acting === `profile-${report.id}`}
          onResolve={() => onResolveProfile(report, 'resolved')}
          onDismiss={() => onResolveProfile(report, 'dismissed')}
          onBlock={() => onBlock({
            key: `profile-${report.id}`,
            profileKey: report.reported_profile_key,
            userId: report.reported_user_id,
            displayName: report.reported_display_name,
          })}
        />
      ))}
      {messageReports.map((report) => (
        <ReportCard
          key={`message-${report.id}`}
          title={report.reported_display_name ?? report.reported_profile_key ?? '未知對象'}
          subtitle="訊息檢舉"
          reason={report.reason}
          details={report.details}
          messageBody={report.message_body}
          status={report.status}
          createdAt={report.created_at}
          acting={acting === report.id || acting === `message-${report.id}`}
          onResolve={() => onResolveMessage(report, 'resolved')}
          onDismiss={() => onResolveMessage(report, 'dismissed')}
          onBlock={() => onBlock({
            key: `message-${report.id}`,
            profileKey: report.reported_profile_key ?? `message:${report.id}`,
            userId: report.reported_user_id,
            displayName: report.reported_display_name,
          })}
        />
      ))}
    </>
  )
}

function ReportCard({
  title,
  subtitle,
  reason,
  details,
  messageBody,
  status,
  createdAt,
  acting,
  onResolve,
  onDismiss,
  onBlock,
}: {
  title: string
  subtitle: string
  reason: string
  details?: string | null
  messageBody?: string | null
  status: string
  createdAt: string
  acting: boolean
  onResolve: () => void
  onDismiss: () => void
  onBlock: () => void
}) {
  const isOpen = status === 'open' || status === 'reviewing'
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-900">{title}</span>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-bold',
              isOpen ? 'bg-red-50 text-red-600' : status === 'resolved' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500',
            )}>
              {isOpen ? '待處理' : status === 'resolved' ? '已處理' : '已駁回'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{subtitle} · {new Date(createdAt).toLocaleString('zh-TW')}</p>
        </div>
        <Flag className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
      </div>

      <div className="rounded-xl bg-red-50 px-3 py-2">
        <p className="text-xs font-bold text-red-600">原因：{reportReasonLabel(reason)}</p>
        {details && <p className="mt-1 text-[11px] leading-relaxed text-red-500">{details}</p>}
      </div>

      {messageBody && (
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-bold text-slate-400">被檢舉訊息</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{messageBody}</p>
        </div>
      )}

      {isOpen && (
        <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
          <button
            onClick={onDismiss}
            disabled={acting}
            className="rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-500 disabled:opacity-60"
          >
            駁回
          </button>
          <button
            onClick={onResolve}
            disabled={acting}
            className="rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-white disabled:opacity-60"
          >
            標記處理
          </button>
          <button
            onClick={onBlock}
            disabled={acting}
            className="rounded-xl bg-red-500 py-2.5 text-xs font-bold text-white disabled:opacity-60 flex items-center justify-center gap-1"
          >
            <Ban className="h-3.5 w-3.5" />
            封鎖
          </button>
        </div>
      )}
    </motion.div>
  )
}

// suppress unused import warnings for icons used conditionally
void Clock

function FeedbackAdminList({
  items,
  acting,
  onResolve,
}: {
  items: UserFeedbackWithProfile[]
  acting: string | null
  onResolve: (item: UserFeedbackWithProfile, status: 'resolved' | 'dismissed') => void
}) {
  if (items.length === 0) {
    return (
      <div className="text-center py-16">
        <MessageSquare className="w-10 h-10 text-slate-200 mx-auto mb-3" />
        <p className="text-sm text-slate-400">目前沒有意見反映</p>
      </div>
    )
  }

  return (
    <>
      {items.map((item) => {
        const displayName = item.profiles?.nickname || item.profiles?.name || '未知用戶'
        const isOpen = item.status === 'open' || item.status === 'reviewing'
        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-slate-900">{displayName}</span>
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-bold',
                    isOpen ? 'bg-amber-50 text-amber-700' : item.status === 'resolved' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500',
                  )}>
                    {isOpen ? '待處理' : item.status === 'resolved' ? '已處理' : '已駁回'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {userFeedbackCategoryLabel(item.category)} · {new Date(item.created_at).toLocaleString('zh-TW')}
                </p>
              </div>
              <MessageSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
            </div>

            <div className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">{item.body}</p>
            </div>

            {item.reviewer_note && (
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-[10px] text-slate-400">審核備註：{item.reviewer_note}</p>
              </div>
            )}

            {isOpen && (
              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
                <button
                  onClick={() => onResolve(item, 'dismissed')}
                  disabled={acting === item.id}
                  className="rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-500 disabled:opacity-60"
                >
                  駁回
                </button>
                <button
                  onClick={() => onResolve(item, 'resolved')}
                  disabled={acting === item.id}
                  className="rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-white disabled:opacity-60"
                >
                  標記處理
                </button>
              </div>
            )}
          </motion.div>
        )
      })}
    </>
  )
}
