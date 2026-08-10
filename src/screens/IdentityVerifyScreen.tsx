import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Camera, FileText, Trash2, ChevronRight, ChevronLeft,
  ShieldCheck, AlertCircle, Upload, Gem, Sparkles, LogOut, Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  uploadProofDoc,
  upsertProfile,
  getProfile,
  resolvePhotoUrls,
  submitVerificationApplication,
  getTodayVerificationApplicationCount,
  getLatestVerificationRejectionNote,
  markVerificationReviewNotificationsRead,
  type VerificationApplicationDocInput,
} from '@/lib/db'
import {
  PROFILE_PHOTO_MIN,
  PROFILE_PHOTO_MAX,
  VERIFICATION_MANUAL_SLA_HOURS,
  type IncomeTier,
  type VerificationStatus,
} from '@/lib/types'
import { IncomeCrownBadge } from '@/components/IncomeBorder'
import { clickFileInputWithGrace } from '@/lib/resumeHardReload'
import {
  loadOnboardingJsonDraft,
  saveOnboardingJsonDraft,
  useOnboardingForegroundRepair,
} from '@/lib/onboardingDraft'
import { LifePhotoUploadSection, type LifePhotoSlot } from '@/components/LifePhotoUploadSection'
import { MembershipDiscountGuide } from '@/components/MembershipDiscountGuide'
import {
  VERIFICATION_DAILY_SUBMIT_LIMIT,
  VERIFICATION_APPLICATION_REJECTION_FOOTER,
} from '@/lib/verificationAiUtils'
import { sanitizeVerificationUserMessage } from '@/lib/companyDisplay'
import { useVerificationReviewNotifications } from '@/hooks/useVerificationReviewNotifications'
import { useWebPushSubscriptionSync } from '@/hooks/useWebPushSubscriptionSync'

interface Props {
  userId?: string
  onComplete: () => void
  onEditProfile?: () => void
  onEditQuestionnaire?: () => void
  onSignOut?: () => void
}

interface ProofItem {
  id: string
  name: string
  type: string
  file: File
  previewUrl: string
  /** data URL（供 sessionStorage 草稿還原；讀取失敗時為空字串） */
  dataUrl: string
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => resolve('')
    reader.readAsDataURL(file)
  })
}

const STEPS = ['生活照上傳', '會員資料確認']

const TIER_CARDS: { tier: IncomeTier; range: string; desc: string }[] = [
  { tier: 'silver', range: '200萬+', desc: '銀皇冠標章' },
  { tier: 'gold', range: '300萬+', desc: '金皇冠標章' },
  { tier: 'diamond', range: '400萬+', desc: '鑽石皇冠標章' },
]

type VerifyDraftSnapshot = {
  step: number
  selectedTier: IncomeTier | null
  /** 舊流程草稿相容：保留但不再要求或送出政府證件，避免升級後覆寫既有草稿。 */
  identityDoc?: { name: string; type: string; dataUrl: string }
  bonusDoc?: { name: string; type: string; dataUrl: string }
  taxDoc?: { name: string; type: string; dataUrl: string }
}

async function dataUrlToFile(dataUrl: string, name: string, type: string): Promise<File> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  return new File([blob], name, { type: type || blob.type })
}

function VerifyWaitActions({
  onEditProfile,
  onEditQuestionnaire,
  onSignOut,
  className,
}: {
  onEditProfile?: () => void
  onEditQuestionnaire?: () => void
  onSignOut?: () => void
  className?: string
}) {
  if (!onEditProfile && !onEditQuestionnaire && !onSignOut) return null
  return (
    <div className={cn('flex flex-col gap-2 w-full max-w-[300px]', className)}>
      {onEditProfile ? (
        <button
          type="button"
          onClick={onEditProfile}
          className="w-full py-3 rounded-2xl text-sm font-bold bg-white text-slate-800 ring-1 ring-slate-200 shadow-sm active:bg-slate-50"
        >
          編輯個人資料
        </button>
      ) : null}
      {onEditQuestionnaire ? (
        <button
          type="button"
          onClick={onEditQuestionnaire}
          className="w-full py-3 rounded-2xl text-sm font-bold bg-white text-slate-800 ring-1 ring-slate-200 shadow-sm active:bg-slate-50"
        >
          修改問卷答案
        </button>
      ) : null}
      {onSignOut ? (
        <button
          type="button"
          onClick={onSignOut}
          className="w-full py-2.5 rounded-2xl text-sm font-semibold text-slate-500 flex items-center justify-center gap-1.5 active:text-slate-700"
        >
          <LogOut className="w-4 h-4" />
          登出
        </button>
      ) : null}
    </div>
  )
}

function ProofPreview({
  item,
  onRemove,
  label,
}: {
  item: ProofItem
  onRemove: () => void
  label: string
}) {
  const isPdf = item.type === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf')
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-600">{label}</p>
        <button type="button" onClick={onRemove} className="text-xs text-red-500 font-semibold flex items-center gap-1">
          <Trash2 className="w-3.5 h-3.5" /> 移除
        </button>
      </div>
      {isPdf ? (
        <p className="text-sm text-slate-700 truncate">{item.name}</p>
      ) : (
        <img src={item.previewUrl} alt={label} className="w-full max-h-48 object-contain rounded-xl bg-slate-50" />
      )}
    </div>
  )
}

export default function IdentityVerifyScreen({
  userId,
  onComplete,
  onEditProfile,
  onEditQuestionnaire,
  onSignOut,
}: Props) {
  const [step, setStep] = useState(0)
  const [photos, setPhotos] = useState<LifePhotoSlot[]>([])
  const [identityDoc, setIdentityDoc] = useState<ProofItem | null>(null)
  const [bonusDoc, setBonusDoc] = useState<ProofItem | null>(null)
  const [selectedTier, setSelectedTier] = useState<IncomeTier | null>(null)
  const [taxDoc, setTaxDoc] = useState<ProofItem | null>(null)
  const [declaredCompany, setDeclaredCompany] = useState('')
  const [applicantGender, setApplicantGender] = useState<'male' | 'female' | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [verifyGate, setVerifyGate] = useState<VerificationStatus | 'loading' | null>(
    userId ? 'loading' : null,
  )
  const [reviewPendingHold, setReviewPendingHold] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [dailyCount, setDailyCount] = useState<number | null>(null)
  const [rejectionNote, setRejectionNote] = useState<string | null>(null)
  const [reviewNotificationCutoff, setReviewNotificationCutoff] = useState<string | null>(null)

  const bonusInputRef = useRef<HTMLInputElement>(null)
  const taxInputRef = useRef<HTMLInputElement>(null)

  useOnboardingForegroundRepair(true)

  /** 送審帳號常停在本畫面、從未進主畫面；沒有這行就不會有推播訂閱，審核結果推不出去。 */
  useWebPushSubscriptionSync(userId)

  const waitingForReview = reviewPendingHold || verifyGate === 'submitted'

  const onReviewApproved = useCallback(() => {
    setVerifyGate('approved')
    setReviewPendingHold(false)
  }, [])

  const onReviewRejected = useCallback(() => {
    setVerifyGate('rejected')
    setReviewPendingHold(false)
  }, [])

  const { alertPortal, notifyReviewResult } = useVerificationReviewNotifications({
    userId,
    enabled: Boolean(userId) && waitingForReview,
    notBefore: reviewNotificationCutoff,
    onApproved: onReviewApproved,
    onRejected: onReviewRejected,
  })

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      const p = await getProfile(userId)
      if (cancelled) return
      setDeclaredCompany(p?.company?.trim() ?? '')
      setApplicantGender(p?.gender === 'male' || p?.gender === 'female' ? p.gender : null)
      const st = p?.verification_status ?? 'pending'
      setVerifyGate(st)
      if (st === 'submitted') setReviewPendingHold(true)
      if (st === 'rejected') {
        const note = await getLatestVerificationRejectionNote(userId)
        if (!cancelled) setRejectionNote(note)
      } else if (!cancelled) {
        setRejectionNote(null)
      }
      if (st === 'approved') return

      const paths = (p?.photo_urls ?? []).filter(Boolean)
      if (paths.length > 0) {
        const urls = await resolvePhotoUrls(paths)
        setPhotos(
          paths.map((storagePath, i) => ({
            id: `server-${i}-${storagePath}`,
            storagePath,
            previewUrl: urls[i] ?? '',
          })),
        )
      }

      void getTodayVerificationApplicationCount(userId).then(setDailyCount)
    })()
    return () => { cancelled = true }
  }, [userId])

  /** approved 不可在 render 期呼叫 onComplete（父層 setState）——用 effect 導航 */
  useEffect(() => {
    if (verifyGate === 'approved') onComplete()
  }, [verifyGate, onComplete])

  useEffect(() => {
    if (!userId || !waitingForReview) return
    const poll = window.setInterval(async () => {
      const p = await getProfile(userId)
      if (p?.verification_status === 'approved') {
        notifyReviewResult('verification_approved')
      } else if (p?.verification_status === 'rejected') {
        const note = await getLatestVerificationRejectionNote(userId)
        setRejectionNote(note)
        notifyReviewResult('verification_rejected', { reviewerNote: note })
      }
    }, 4000)
    return () => window.clearInterval(poll)
  }, [userId, waitingForReview, notifyReviewResult])

  useEffect(() => {
    if (!userId || !draftHydrated) return
    const snapshot: VerifyDraftSnapshot = {
      step,
      selectedTier,
      identityDoc: identityDoc
        ? { name: identityDoc.name, type: identityDoc.type, dataUrl: identityDoc.dataUrl }
        : undefined,
      bonusDoc: bonusDoc
        ? { name: bonusDoc.name, type: bonusDoc.type, dataUrl: bonusDoc.dataUrl }
        : undefined,
      taxDoc: taxDoc
        ? { name: taxDoc.name, type: taxDoc.type, dataUrl: taxDoc.dataUrl }
        : undefined,
    }
    saveOnboardingJsonDraft(userId, 'identity-verify', snapshot)
  }, [userId, draftHydrated, step, selectedTier, identityDoc, bonusDoc, taxDoc])

  useEffect(() => {
    if (!userId) {
      setDraftHydrated(true)
      return
    }
    let cancelled = false
    void (async () => {
      const draft = loadOnboardingJsonDraft<VerifyDraftSnapshot>(userId, 'identity-verify')
      if (cancelled) return
      if (draft) {
        if (typeof draft.step === 'number') setStep(Math.min(draft.step, STEPS.length - 1))
        if (draft.selectedTier) setSelectedTier(draft.selectedTier)
        const restore = async (raw: { name: string; type: string; dataUrl: string } | undefined) => {
          if (!raw?.dataUrl?.startsWith('data:')) return null
          const file = await dataUrlToFile(raw.dataUrl, raw.name, raw.type)
          return {
            id: `${Date.now()}-${raw.name}`,
            name: raw.name,
            type: raw.type,
            file,
            previewUrl: URL.createObjectURL(file),
            dataUrl: raw.dataUrl,
          } satisfies ProofItem
        }
        const idDoc = await restore(draft.identityDoc)
        const bDoc = await restore(draft.bonusDoc)
        const tDoc = await restore(draft.taxDoc)
        if (idDoc) setIdentityDoc(idDoc)
        if (bDoc) setBonusDoc(bDoc)
        if (tDoc) setTaxDoc(tDoc)
      }
      setDraftHydrated(true)
    })()
    return () => { cancelled = true }
  }, [userId])

  const handleLifePhotoUploadSuccess = async (next: LifePhotoSlot[]) => {
    if (!userId) return
    await upsertProfile({ userId, photoUrls: next.map((p) => p.storagePath) })
  }

  const pickProof = (
    files: FileList | null,
    setItem: (item: ProofItem | null) => void,
    clearPrev: ProofItem | null,
  ) => {
    if (!files?.length) return
    if (clearPrev) URL.revokeObjectURL(clearPrev.previewUrl)
    const f = files[0]
    setSubmitError('')
    void fileToDataUrl(f).then((dataUrl) => {
      setItem({
        id: `${Date.now()}-${f.name}`,
        name: f.name,
        type: f.type,
        file: f,
        previewUrl: URL.createObjectURL(f),
        dataUrl,
      })
    })
  }

  const photosReady = photos.length >= PROFILE_PHOTO_MIN
    && photos.every((p) => Boolean(p.storagePath))

  const taxReady = !selectedTier || Boolean(taxDoc)
  const companyReady = declaredCompany.trim().length >= 2

  const stepLabel = STEPS[step]
  const isLastStep = step === STEPS.length - 1

  const canAdvance = (() => {
    if (stepLabel === '生活照上傳') return photosReady
    if (stepLabel === '會員資料確認') {
      return taxReady && companyReady
        && (dailyCount === null || dailyCount < VERIFICATION_DAILY_SUBMIT_LIMIT)
    }
    return false
  })()

  const buildSubmitDocs = async (): Promise<VerificationApplicationDocInput[] | { error: string }> => {
    if (!userId) return { error: '請先登入。' }
    if (selectedTier && !taxDoc) return { error: '選擇收入皇冠時須上傳扣繳憑單。' }
    if (!companyReady) return { error: '請先在個人資料填寫任職公司。' }

    const docs: VerificationApplicationDocInput[] = []

    if (bonusDoc) {
      const bonusUpload = await uploadProofDoc(userId, bonusDoc.file)
      if (!bonusUpload.ok) return { error: bonusUpload.error ?? '加分文件上傳失敗。' }
      docs.push({ kind: 'bonus', docType: 'other', path: bonusUpload.path })
    }

    if (selectedTier && taxDoc) {
      const taxUpload = await uploadProofDoc(userId, taxDoc.file)
      if (!taxUpload.ok) return { error: taxUpload.error ?? '扣繳憑單上傳失敗。' }
      docs.push({
        kind: 'income',
        docType: 'tax_return',
        path: taxUpload.path,
        claimedIncomeTier: selectedTier,
      })
    }

    return docs
  }

  const handleConfirmSubmit = async () => {
    if (!userId || submitting) return
    setSubmitting(true)
    setSubmitError('')
    setShowConfirmModal(false)

    const built = await buildSubmitDocs()
    if ('error' in built) {
      setSubmitError(built.error)
      setSubmitting(false)
      return
    }

    const result = await submitVerificationApplication(userId, declaredCompany, built)
    if (!result.ok) {
      setSubmitError(result.error ?? '送審失敗，請稍後再試。')
      setSubmitting(false)
      return
    }

    // 必須先把上一輪結果設為已讀，再啟用 waiting 的通知 backlog；
    // 否則舊退件會被誤判成本輪剛退件，使用者會立刻被送回表單。
    await markVerificationReviewNotificationsRead(userId)
    setRejectionNote(null)
    setReviewNotificationCutoff(new Date().toISOString())
    setVerifyGate('submitted')
    setReviewPendingHold(true)
    setSubmitting(false)
    void getTodayVerificationApplicationCount(userId).then(setDailyCount)
  }

  if (verifyGate === 'loading') {
    return (
      <>
        <div className="min-h-dvh max-w-md mx-auto flex items-center justify-center bg-[#fafafa]">
          <p className="text-sm text-slate-500">載入中…</p>
        </div>
        {alertPortal}
      </>
    )
  }

  if (waitingForReview) {
    return (
      <>
      <div className="min-h-dvh max-w-md mx-auto flex flex-col items-center overflow-y-auto bg-[#fafafa] px-6 pb-[calc(env(safe-area-inset-bottom,0px)+32px)] pt-[calc(env(safe-area-inset-top,0px)+32px)] text-center">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="my-auto w-full space-y-4">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
            <Clock className="w-8 h-8 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">人工審核中</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            我們已收到你的申請，目前採<strong className="text-slate-700">全人工審核</strong>。
            <br />
            最長等待時間約 {VERIFICATION_MANUAL_SLA_HOURS} 小時，通過後會通知你。
          </p>
          <p className="text-[11px] text-slate-400 leading-[1.7]">
            選填的加分與收入文件僅供審核使用
            <br />
            <strong className="text-slate-500">審核通過後，檔案即刪除</strong>
            <br />
            不留存於伺服器
          </p>
          {applicantGender && (
            <MembershipDiscountGuide
              gender={applicantGender}
              className="mx-auto w-full max-w-[340px]"
            />
          )}
          <VerifyWaitActions
            onEditProfile={onEditProfile}
            onEditQuestionnaire={onEditQuestionnaire}
            onSignOut={onSignOut}
            className="mx-auto pt-2"
          />
        </motion.div>
      </div>
      {alertPortal}
      </>
    )
  }

  if (verifyGate === 'approved') {
    return (
      <>
        <div className="min-h-dvh max-w-md mx-auto flex items-center justify-center bg-[#fafafa]">
          <p className="text-sm text-slate-500">審核已通過，正在進入…</p>
        </div>
        {alertPortal}
      </>
    )
  }

  return (
    <>
    <div className="min-h-dvh max-w-md mx-auto flex flex-col bg-[#fafafa]">
      <div className="px-5 pt-safe pb-6">
        <div className="flex items-center gap-3 mb-6">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="w-8 h-8 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
          )}
          <div className="flex-1">
            <div className="flex gap-1.5 mb-2">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-all duration-300',
                    i <= step ? 'bg-slate-900' : 'bg-slate-200',
                  )}
                />
              ))}
            </div>
            <p className="text-xs text-slate-400">{step + 1} / {STEPS.length} — {stepLabel}</p>
          </div>
        </div>

        {verifyGate === 'rejected' && (
          <div className="mb-4 rounded-2xl bg-red-50 px-4 py-3 ring-1 ring-red-100">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-red-800">上次審核未通過</p>
                {rejectionNote ? (
                  <div className="mt-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-red-600">退件原因</p>
                    <p className="mt-1 text-sm leading-relaxed text-red-800">
                      {sanitizeVerificationUserMessage(rejectionNote)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-red-700 leading-relaxed">
                    管理員未留下文字說明，請確認證件是否清楚、資料是否一致後重新送審。
                  </p>
                )}
                <p className="mt-2 text-xs text-red-700 leading-relaxed">
                  {VERIFICATION_APPLICATION_REJECTION_FOOTER}
                </p>
              </div>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
          >
            {stepLabel === '生活照上傳' && (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <Camera className="w-4 h-4 text-slate-400" />
                  <h2 className="text-xl font-bold text-slate-900">上傳生活照</h2>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                  須通過 AI 審核（正面獨照）後才能進入下一步送審。至少 {PROFILE_PHOTO_MIN} 張，最多 {PROFILE_PHOTO_MAX} 張。
                </p>
              </>
            )}
            {stepLabel === '會員資料確認' && (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <h2 className="text-xl font-bold text-slate-900">會員資料確認</h2>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                  不需上傳身分證件。送出後由人工審核，最長約 {VERIFICATION_MANUAL_SLA_HOURS} 小時。
                </p>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex-1 px-5 overflow-y-auto pb-4">
        {stepLabel === '生活照上傳' && userId && (
          <LifePhotoUploadSection
            userId={userId}
            photos={photos}
            onPhotosChange={setPhotos}
            onUploadSuccess={handleLifePhotoUploadSuccess}
          />
        )}

        {stepLabel === '會員資料確認' && (
          <div className="space-y-4">
            {!companyReady && (
              <div className="rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800 leading-relaxed">
                請先在「編輯個人資料」填寫任職公司，再送審。
                {onEditProfile ? (
                  <button type="button" onClick={onEditProfile} className="block mt-2 font-bold underline">
                    前往填寫
                  </button>
                ) : null}
              </div>
            )}
            {companyReady && (
              <div className="bg-white rounded-2xl p-4 ring-1 ring-slate-100">
                <p className="text-xs text-slate-400">自述任職公司</p>
                <p className="text-sm font-bold text-slate-900 mt-1">{declaredCompany}</p>
              </div>
            )}

            {/* 任職加分為男女皆選填；保留既有草稿內容，不因流程放寬而清除。 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100 space-y-3">
              <p className="text-xs font-semibold text-slate-800">
                任職加分或其他對您有利的證明 <span className="text-slate-400 font-normal">（選填）</span>
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                例如員工證、識別證、在職證明、名片等能佐證任職或身分的文件。
              </p>
              <input ref={bonusInputRef} type="file" accept="image/*,.pdf" className="hidden"
                onChange={(e) => pickProof(e.target.files, setBonusDoc, bonusDoc)} />
              {!bonusDoc ? (
                <button
                  type="button"
                  onClick={() => clickFileInputWithGrace(bonusInputRef.current)}
                  className="w-full py-3 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" /> 上傳文件
                </button>
              ) : (
                <ProofPreview item={bonusDoc} label="已選文件" onRemove={() => { URL.revokeObjectURL(bonusDoc.previewUrl); setBonusDoc(null) }} />
              )}
            </div>

            {/* Income crown optional */}
            <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100 space-y-3">
              <div className="flex items-center gap-2">
                <Gem className="w-4 h-4 text-slate-400" />
                <p className="text-xs font-semibold text-slate-800">收入皇冠（選填）</p>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">上傳扣繳憑單並選擇等級；通過審核後可開啟皇冠顯示。不影響進入探索。</p>
              <div className="space-y-2">
                {TIER_CARDS.map(({ tier, range, desc }) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setSelectedTier(selectedTier === tier ? null : tier)}
                    className={cn(
                      'w-full rounded-xl border-2 p-3 text-left transition-all flex items-center gap-3',
                      selectedTier === tier ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white',
                    )}
                  >
                    <IncomeCrownBadge tier={tier} compact />
                    <div>
                      <p className="text-sm font-bold">{range}</p>
                      <p className={cn('text-[11px]', selectedTier === tier ? 'text-white/80' : 'text-slate-400')}>{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
              {selectedTier && (
                <>
                  <input ref={taxInputRef} type="file" accept="image/*,.pdf" className="hidden"
                    onChange={(e) => pickProof(e.target.files, setTaxDoc, taxDoc)} />
                  {!taxDoc ? (
                    <button
                      type="button"
                      onClick={() => clickFileInputWithGrace(taxInputRef.current)}
                      className="w-full py-3 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 flex items-center justify-center gap-2"
                    >
                      <Upload className="w-4 h-4" /> 上傳扣繳憑單
                    </button>
                  ) : (
                    <ProofPreview item={taxDoc} label="扣繳憑單" onRemove={() => { URL.revokeObjectURL(taxDoc.previewUrl); setTaxDoc(null) }} />
                  )}
                </>
              )}
            </div>

            <div className="rounded-2xl bg-slate-50 p-4 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                選填文件僅供人工審核；<strong className="text-slate-700">審核通過後檔案即刪除</strong>，不留存於資料庫。未上傳文件也可送出會員審核。
              </p>
            </div>

            {submitError && (
              <p className="text-xs text-red-600 font-semibold">{submitError}</p>
            )}
            {dailyCount !== null && dailyCount >= VERIFICATION_DAILY_SUBMIT_LIMIT && (
              <p className="text-xs text-amber-700">今日送審已達上限 {VERIFICATION_DAILY_SUBMIT_LIMIT} 次，請明日再試。</p>
            )}
          </div>
        )}
      </div>

      <div className="px-5 pb-10 pt-4 space-y-3">
        {!isLastStep ? (
          <motion.button
            type="button"
            whileTap={{ scale: canAdvance ? 0.97 : 1 }}
            onClick={() => canAdvance && setStep(step + 1)}
            disabled={!canAdvance}
            className={cn(
              'w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2',
              canAdvance ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'bg-slate-100 text-slate-300',
            )}
          >
            下一步
            <ChevronRight className="w-5 h-5" />
          </motion.button>
        ) : (
          <motion.button
            type="button"
            whileTap={{ scale: canAdvance && !submitting ? 0.97 : 1 }}
            onClick={() => canAdvance && !submitting && setShowConfirmModal(true)}
            disabled={!canAdvance || submitting}
            className={cn(
              'w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2',
              canAdvance && !submitting ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'bg-slate-100 text-slate-300',
            )}
          >
            {submitting ? '送審中…' : (
              <>
                <Sparkles className="w-5 h-5" />
                送出審核
              </>
            )}
          </motion.button>
        )}
      </div>

      {createPortal(
        <AnimatePresence>
          {showConfirmModal && (
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
                className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-4"
              >
                <h2 className="text-base font-bold text-slate-900">確定要送出嗎？</h2>
                <p className="text-sm text-slate-500 leading-relaxed">
                  目前採<strong className="text-slate-700">全人工審核</strong>，最長等待約 {VERIFICATION_MANUAL_SLA_HOURS} 小時。
                  <br />
                  如有上傳選填文件，審核通過後即刪除。
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 py-3.5 rounded-2xl bg-slate-100 text-slate-600 text-sm font-semibold"
                  >
                    再檢查一下
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmSubmit()}
                    disabled={submitting}
                    className="flex-1 py-3.5 rounded-2xl bg-slate-900 text-white text-sm font-bold disabled:opacity-60"
                  >
                    確定送出
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
    {alertPortal}
    </>
  )
}
