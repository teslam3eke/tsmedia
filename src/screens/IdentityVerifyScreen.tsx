import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Camera, FileText, Trash2, ChevronRight, ChevronLeft,
  ShieldCheck, AlertCircle, Cpu, Upload, Gem, Sparkles, LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  uploadProofDoc, submitVerificationDoc,
  submitIncomeVerification, upsertProfile,
  getTodayEmploymentVerificationSubmissionCount,
  getTodayIncomeVerificationSubmissionCount,
  getLatestEmploymentVerification,
  getProfile, finalizeDueAiReviews, resolvePhotoUrls,
  type AiResult,
} from '@/lib/db'
import { parseCompany, resolveEmploymentCompany, sanitizeVerificationUserMessage } from '@/lib/companyDisplay'
import {
  buildVerificationApiFailureReason,
  parseVerifyIdResponse,
  postVerifyId,
  resolveManualReviewReason,
  verifyIdReasonFromBody,
  VERIFICATION_AI_PREFLIGHT_FAIL_USER_MESSAGE,
  VERIFICATION_MANUAL_REVIEW_TAIL,
  VERIFICATION_MANUAL_REVIEW_USER_MESSAGE,
  VERIFICATION_DAILY_SUBMIT_LIMIT,
  VERIFICATION_SUBMIT_INTERRUPT_USER_MESSAGE,
  VERIFICATION_SUBMIT_TIMEOUT_USER_MESSAGE,
  VERIFY_ID_FETCH_TIMEOUT_MS,
} from '@/lib/verificationAiUtils'
import { AI_AUTO_REVIEW_UI_SECONDS } from '@/lib/aiReviewConstants'
import { PROFILE_PHOTO_MIN, PROFILE_PHOTO_MAX, type Company, type DocType, type IncomeTier, type VerificationStatus } from '@/lib/types'
import { IncomeBorder } from '@/components/IncomeBorder'
import { clickFileInputWithGrace } from '@/lib/resumeHardReload'
import {
  loadOnboardingJsonDraft,
  saveOnboardingJsonDraft,
  useOnboardingForegroundRepair,
} from '@/lib/onboardingDraft'
import { LifePhotoUploadSection, type LifePhotoSlot } from '@/components/LifePhotoUploadSection'

interface Props {
  userId?: string
  claimedName?: string | null
  gender?: 'male' | 'female'
  onComplete: () => void
  /** 職業審核 submitted 等待時：可返回編輯資料／問卷或登出 */
  onEditProfile?: () => void
  onEditQuestionnaire?: () => void
  onSignOut?: () => void
}

interface ProofItem {
  id: string
  name: string
  type: string
  file: File
  previewUrl: string   // object URL for in-app preview
}

const STEPS_MALE   = ['生活照上傳', '職業驗證文件', '收入認證（選填）']
/** AI 自動審核最長等待（秒）＋緩衝；逾時或已轉人工則改靜態等待頁 */
const EMPLOYMENT_AI_WAIT_MAX_MS = (AI_AUTO_REVIEW_UI_SECONDS + 15) * 1000
const EMPLOYMENT_PENDING_POLL_MS = 5_000
/** 送審 overlay 期間切 App 超過此時間 → 視為中斷，關 overlay 請使用者重送 */
const SUBMIT_BACKGROUND_INTERRUPT_MS = 2 * 60 * 1000
/** 送審 overlay 前景最長停留（與 verify-id 同為 2 分鐘） */
const SUBMIT_OVERLAY_STALL_MS = VERIFY_ID_FETCH_TIMEOUT_MS

function assertSubmitNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Submit aborted', 'AbortError')
  }
}
/** 女生 onboarding 僅生活照；收入／薪資認證改由站內「編輯個人資訊」處理 */
const STEPS_FEMALE = ['生活照上傳']

const EMPLOYMENT_DOC_TYPES: { value: 'employee_id' | 'tax_return' | 'payslip'; label: string }[] = [
  { value: 'employee_id', label: '員工證 / 識別證' },
  { value: 'tax_return', label: '扣繳憑單' },
  { value: 'payslip', label: '薪資單' },
]

type VerifyDraftSnapshot = {
  step: number
  employmentDocType: 'employee_id' | 'tax_return' | 'payslip' | ''
  selectedTier: IncomeTier | null
  proof?: { name: string; type: string; dataUrl: string }
  incomeDoc?: { name: string; type: string; dataUrl: string }
}

async function dataUrlToFile(dataUrl: string, name: string, type: string): Promise<File> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  return new File([blob], name, { type: type || blob.type })
}

const TIER_CARDS: { tier: IncomeTier; range: string; desc: string }[] = [
  { tier: 'silver',  range: '200萬+', desc: '銀皇冠標章' },
  { tier: 'gold',    range: '300萬+', desc: '金皇冠標章' },
  { tier: 'diamond', range: '400萬+', desc: '鑽石皇冠標章' },
]
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

export default function IdentityVerifyScreen({
  userId,
  claimedName,
  gender = 'male',
  onComplete,
  onEditProfile,
  onEditQuestionnaire,
  onSignOut,
}: Props) {
  const steps = gender === 'female' ? STEPS_FEMALE : STEPS_MALE
  const [step, setStep] = useState(0)
  const [photos, setPhotos] = useState<LifePhotoSlot[]>([])
  const [proofs, setProofs] = useState<ProofItem[]>([])
  const [employmentDocType, setEmploymentDocType] = useState<'employee_id' | 'tax_return' | 'payslip' | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [draftHydrated, setDraftHydrated] = useState(false)

  useOnboardingForegroundRepair(true)

  // ── Income verification state ────────────────────────────────────
  const [selectedTier, setSelectedTier] = useState<IncomeTier | null>(null)
  const [incomeDoc, setIncomeDoc]       = useState<ProofItem | null>(null)

  // ── AI verification state ────────────────────────────────────────
  const [aiStatus,     setAiStatus]     = useState<'idle' | 'ok' | 'fail'>('idle')
  const [aiMessage,    setAiMessage]    = useState('')

  const [incomeApprovalWait, setIncomeApprovalWait] = useState(false)
  const [incomeApprovalWaitMessage, setIncomeApprovalWaitMessage] = useState('正在處理收入認證…')
  const [employmentDailyCount, setEmploymentDailyCount] = useState<number | null>(null)
  const [incomeDailyCount, setIncomeDailyCount] = useState<number | null>(null)

  /** 男性職業驗證狀態（須 approved 才可進探索） */
  const [maleVerifyGate, setMaleVerifyGate] = useState<VerificationStatus | 'loading' | null>(
    gender === 'male' && userId ? 'loading' : null,
  )
  /** 職業步驟：人工審核中，通過後自動進收入頁 */
  const [employmentManualWait, setEmploymentManualWait] = useState(false)
  /** employmentManualWait overlay 動態訊息 */
  const [employmentWaitMessage, setEmploymentWaitMessage] = useState('職業驗證審核中')
  /** 人工審核中：靜態等待頁（慢速輪詢，避免無限高頻請求） */
  const [employmentReviewPendingHold, setEmploymentReviewPendingHold] = useState(false)
  const submissionAbortRef = useRef<AbortController | null>(null)
  const submissionInterruptReasonRef = useRef<'background' | 'timeout' | null>(null)

  const abortActiveSubmission = () => {
    submissionAbortRef.current?.abort()
    submissionAbortRef.current = null
  }

  const beginSubmissionAbortScope = () => {
    abortActiveSubmission()
    const ac = new AbortController()
    submissionAbortRef.current = ac
    return ac
  }

  const resolveSubmitAbortUserMessage = () =>
    submissionInterruptReasonRef.current === 'background'
      ? VERIFICATION_SUBMIT_INTERRUPT_USER_MESSAGE
      : VERIFICATION_SUBMIT_TIMEOUT_USER_MESSAGE

  /** 職業文件已在步驟 2 送審；最後一步勿重複上傳 */
  const employmentSubmittedRef = useRef(false)
  const draftProofAiQueuedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (!userId) {
      setPhotos([])
      if (gender !== 'male') setMaleVerifyGate(null)
      setDraftHydrated(true)
      return
    }
    let cancelled = false
    void (async () => {
      const draft = loadOnboardingJsonDraft<VerifyDraftSnapshot>(userId, 'identity-verify')
      const p = await getProfile(userId)
      if (cancelled || !p) {
        if (!cancelled) setDraftHydrated(true)
        return
      }

      const storedPaths = (p.photo_urls ?? []).filter(Boolean)
      if (storedPaths.length > 0) {
        const signedUrls = await resolvePhotoUrls(storedPaths)
        if (cancelled) return
        setPhotos(
          storedPaths.slice(0, PROFILE_PHOTO_MAX).map((path, i) => ({
            id: `existing-${i}`,
            previewUrl: signedUrls[i] ?? path,
            storagePath: path,
          })),
        )
      } else {
        setPhotos([])
      }

      if (gender === 'male') {
        const st = p.verification_status ?? 'pending'
        setMaleVerifyGate(st)
        if (st === 'approved') {
          employmentSubmittedRef.current = true
          if (storedPaths.length >= PROFILE_PHOTO_MIN) {
            setStep(2)
          }
        } else if (st === 'submitted' && storedPaths.length >= PROFILE_PHOTO_MIN) {
          employmentSubmittedRef.current = true
          setStep(2)
          const empDoc = await getLatestEmploymentVerification(userId)
          if (cancelled) return
          if (empDoc?.review_mode === 'manual') {
            setEmploymentReviewPendingHold(true)
          }
        } else if (st === 'rejected' && storedPaths.length >= PROFILE_PHOTO_MIN) {
          employmentSubmittedRef.current = false
          setStep(1)
        }
      } else {
        setMaleVerifyGate(null)
      }

      if (draft && !cancelled) {
        if (typeof draft.step === 'number') setStep(draft.step)
        if (draft.employmentDocType) setEmploymentDocType(draft.employmentDocType)
        if (draft.selectedTier) setSelectedTier(draft.selectedTier)
        if (draft.proof?.dataUrl) {
          try {
            const file = await dataUrlToFile(draft.proof.dataUrl, draft.proof.name, draft.proof.type)
            if (!cancelled) {
              setProofs([{
                id: `draft-${Date.now()}`,
                name: draft.proof.name,
                type: draft.proof.type,
                file,
                previewUrl: URL.createObjectURL(file),
              }])
              draftProofAiQueuedRef.current = true
            }
          } catch {
            /* 草稿損壞時略過 */
          }
        }
        if (draft.incomeDoc?.dataUrl) {
          try {
            const file = await dataUrlToFile(draft.incomeDoc.dataUrl, draft.incomeDoc.name, draft.incomeDoc.type)
            if (!cancelled) {
              setIncomeDoc({
                id: `draft-income-${Date.now()}`,
                name: draft.incomeDoc.name,
                type: draft.incomeDoc.type,
                file,
                previewUrl: URL.createObjectURL(file),
              })
            }
          } catch {
            /* ignore */
          }
        }
      }

      if (!cancelled) setDraftHydrated(true)
    })()
    return () => { cancelled = true }
  }, [userId, gender])

  useEffect(() => {
    if (gender !== 'male' || !userId || step !== 1) return
    let cancelled = false
    void getTodayEmploymentVerificationSubmissionCount(userId).then((count) => {
      if (!cancelled) setEmploymentDailyCount(count)
    })
    return () => { cancelled = true }
  }, [gender, userId, step, proofs.length])

  useEffect(() => {
    if (gender !== 'male' || !userId || step !== 2) return
    let cancelled = false
    void getTodayIncomeVerificationSubmissionCount(userId).then((count) => {
      if (!cancelled) setIncomeDailyCount(count)
    })
    return () => { cancelled = true }
  }, [gender, userId, step, incomeDoc])

  const waitForEmploymentApproval = async (
    setPhase?: (msg: string) => void,
  ): Promise<{ ok: boolean; error?: string; pendingManual?: boolean }> => {
    if (!userId) return { ok: false, error: '請先登入。' }
    setPhase?.('等待職業驗證通過…')
    const deadline = Date.now() + EMPLOYMENT_AI_WAIT_MAX_MS
    while (Date.now() < deadline) {
      await finalizeDueAiReviews()
      const p = await getProfile(userId)
      if (p?.verification_status === 'approved') {
        setMaleVerifyGate('approved')
        return { ok: true }
      }
      if (p?.verification_status === 'rejected') {
        employmentSubmittedRef.current = false
        setMaleVerifyGate('rejected')
        return { ok: false, error: '職業驗證未通過，請重新上傳文件。' }
      }
      const empDoc = await getLatestEmploymentVerification(userId)
      if (empDoc?.review_mode === 'manual' && empDoc.status === 'pending') {
        return { ok: false, pendingManual: true }
      }
      await new Promise((r) => setTimeout(r, 800))
    }
    return { ok: false, pendingManual: true }
  }

  /** 人工審核靜態等待：通過後自動進探索，拒絕則回職業步驟 */
  useEffect(() => {
    if (!employmentReviewPendingHold || !userId || gender !== 'male') return
    let cancelled = false
    const tick = async () => {
      await finalizeDueAiReviews()
      const p = await getProfile(userId)
      if (cancelled) return
      if (p?.verification_status === 'approved') {
        setMaleVerifyGate('approved')
        setEmploymentReviewPendingHold(false)
        onCompleteRef.current()
        return
      }
      if (p?.verification_status === 'rejected') {
        employmentSubmittedRef.current = false
        setMaleVerifyGate('rejected')
        setEmploymentReviewPendingHold(false)
        setStep(1)
        setAiStatus('fail')
        setAiMessage('職業驗證未通過，請重新上傳文件。')
      }
    }
    void tick()
    const iv = window.setInterval(() => void tick(), EMPLOYMENT_PENDING_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(iv)
    }
  }, [employmentReviewPendingHold, userId, gender])

  useEffect(() => () => abortActiveSubmission(), [])

  /** 送審 overlay（非「已送審等結果」）：背景過久回前景 → 中斷並請重送 */
  useEffect(() => {
    const isEmploymentSubmitting =
      employmentManualWait && !employmentWaitMessage.startsWith('等待職業驗證')
    if (!isEmploymentSubmitting && !incomeApprovalWait) return

    let hiddenAt: number | null = null

    const interruptSubmit = () => {
      submissionInterruptReasonRef.current = 'background'
      abortActiveSubmission()
      setEmploymentManualWait(false)
      setIncomeApprovalWait(false)
      setAiStatus('fail')
      setAiMessage(VERIFICATION_SUBMIT_INTERRUPT_USER_MESSAGE)
      submissionInterruptReasonRef.current = null
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt == null) return
      const elapsed = Date.now() - hiddenAt
      hiddenAt = null
      if (elapsed >= SUBMIT_BACKGROUND_INTERRUPT_MS) interruptSubmit()
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [employmentManualWait, employmentWaitMessage, incomeApprovalWait])

  /** 送審 overlay：最長停留逾時（避免 iOS 背景 throttle 後無限卡住） */
  useEffect(() => {
    const isEmploymentSubmitting =
      employmentManualWait && !employmentWaitMessage.startsWith('等待職業驗證')
    if (!isEmploymentSubmitting && !incomeApprovalWait) return

    const t = window.setTimeout(() => {
      submissionInterruptReasonRef.current = 'timeout'
      abortActiveSubmission()
      setEmploymentManualWait(false)
      setIncomeApprovalWait(false)
      setAiStatus('fail')
      setAiMessage(VERIFICATION_SUBMIT_TIMEOUT_USER_MESSAGE)
      submissionInterruptReasonRef.current = null
    }, SUBMIT_OVERLAY_STALL_MS)

    return () => window.clearTimeout(t)
  }, [employmentManualWait, employmentWaitMessage, incomeApprovalWait])

  const employmentAiOutcomeRef = useRef<{
    passed: boolean
    message: string
    company: Company | null
    confidence: 'high' | 'medium' | 'low' | null
    reason: string | null
  } | null>(null)

  const incomeAiOutcomeRef = useRef<{
    aiResult: AiResult
    reviewMode: 'ai_auto' | 'manual'
    manualReason: string
  } | null>(null)

  const proofInputRef  = useRef<HTMLInputElement>(null)
  const incomeInputRef = useRef<HTMLInputElement>(null)

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  type EmploymentAiOutcome = NonNullable<typeof employmentAiOutcomeRef.current>

  const fetchEmploymentAiOutcome = async (
    file: File,
    docTypeOverride?: 'employee_id' | 'tax_return' | 'payslip',
    signal?: AbortSignal,
  ): Promise<EmploymentAiOutcome | null> => {
    employmentAiOutcomeRef.current = null
    try {
      assertSubmitNotAborted(signal)
      const imageBase64 = await fileToBase64(file)
      assertSubmitNotAborted(signal)
      const docTypeHint: 'employee_id' | 'tax_return' | 'payslip' | 'other' =
        docTypeOverride
        ?? (file.type === 'application/pdf' ? 'tax_return' : 'employee_id')
      const res = await postVerifyId({
        imageBase64,
        verificationKind: 'employment',
        claimedName: claimedName?.trim() || undefined,
        docType: docTypeHint,
      }, { signal })
      assertSubmitNotAborted(signal)
      const { data, failureReason } = await parseVerifyIdResponse(res)
      if (failureReason || !data) {
        const reason = failureReason ?? buildVerificationApiFailureReason(new Error('empty response'))
        employmentAiOutcomeRef.current = {
          passed: false,
          message: reason,
          company: null,
          confidence: null,
          reason,
        }
        return employmentAiOutcomeRef.current
      }
      const aiCompany = parseCompany(data.company)
      const aiConf = (data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low') ? data.confidence : null
      const reason = verifyIdReasonFromBody(data)
      employmentAiOutcomeRef.current = {
        passed: data.ok,
        message: sanitizeVerificationUserMessage(data.message ?? reason),
        company: aiCompany,
        confidence: aiConf,
        reason: data.ok ? (data.reason ? sanitizeVerificationUserMessage(data.reason) : null) : reason,
      }
      return employmentAiOutcomeRef.current
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw err
      }
      console.error('[IdentityVerify] employment verify-id failed:', err)
      const reason = buildVerificationApiFailureReason(err)
      employmentAiOutcomeRef.current = {
        passed: false,
        message: reason,
        company: null,
        confidence: null,
        reason,
      }
      return employmentAiOutcomeRef.current
    }
  }

  const fetchIncomeAiOutcome = async (file: File, tier: IncomeTier, signal?: AbortSignal) => {
    incomeAiOutcomeRef.current = null
    try {
      assertSubmitNotAborted(signal)
      const imageBase64 = await fileToBase64(file)
      assertSubmitNotAborted(signal)
      const res = await postVerifyId({
        imageBase64,
        verificationKind: 'income',
        claimedIncomeTier: tier,
        claimedName: claimedName?.trim() || undefined,
        docType: file.type === 'application/pdf' ? 'tax_return' : 'payslip',
      }, { signal })
      assertSubmitNotAborted(signal)
      const { data, failureReason } = await parseVerifyIdResponse(res)
      if (failureReason || !data) {
        const reason = failureReason ?? buildVerificationApiFailureReason(new Error('empty response'))
        incomeAiOutcomeRef.current = {
          aiResult: {
            passed: false,
            company: null,
            confidence: null,
            reason,
          },
          reviewMode: 'manual',
          manualReason: reason,
        }
        return
      }
      const aiConf = (data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low')
        ? data.confidence
        : null
      const aiResult: AiResult = {
        passed: data.ok,
        company: null,
        confidence: aiConf,
        reason: verifyIdReasonFromBody(data),
      }
      incomeAiOutcomeRef.current = {
        aiResult,
        reviewMode: data.ok ? 'ai_auto' : 'manual',
        manualReason: data.ok ? '' : resolveManualReviewReason(aiResult.reason),
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw err
      }
      console.error('[IdentityVerify] income verify-id failed:', err)
      const reason = buildVerificationApiFailureReason(err)
      incomeAiOutcomeRef.current = {
        aiResult: {
          passed: false,
          company: null,
          confidence: null,
          reason,
        },
        reviewMode: 'manual',
        manualReason: reason,
      }
    }
  }

  useEffect(() => {
    if (!draftProofAiQueuedRef.current) return
    draftProofAiQueuedRef.current = false
  }, [proofs, employmentDocType])

  useEffect(() => {
    if (!draftHydrated || !userId) return
    let cancelled = false
    void (async () => {
      const snapshot: VerifyDraftSnapshot = {
        step,
        employmentDocType,
        selectedTier,
      }
      if (proofs[0]) {
        try {
          snapshot.proof = {
            name: proofs[0].name,
            type: proofs[0].type,
            dataUrl: await fileToBase64(proofs[0].file),
          }
        } catch {
          /* 略過過大檔案 */
        }
      }
      if (incomeDoc) {
        try {
          snapshot.incomeDoc = {
            name: incomeDoc.name,
            type: incomeDoc.type,
            dataUrl: await fileToBase64(incomeDoc.file),
          }
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) saveOnboardingJsonDraft(userId, 'identity-verify', snapshot)
    })()
    return () => { cancelled = true }
  }, [draftHydrated, userId, step, employmentDocType, selectedTier, proofs, incomeDoc])

  const addIncomeDoc = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const f = files[0]
    if (incomeDoc) URL.revokeObjectURL(incomeDoc.previewUrl)
    setIncomeDoc({
      id: `${Date.now()}-${f.name}`,
      name: f.name,
      type: f.type,
      file: f,
      previewUrl: URL.createObjectURL(f),
    })
  }

  const clearIncomeDoc = () => {
    if (incomeDoc) URL.revokeObjectURL(incomeDoc.previewUrl)
    setIncomeDoc(null)
  }

  const handleLifePhotoUploadSuccess = async (next: LifePhotoSlot[]) => {
    if (!userId) return
    await upsertProfile({ userId, photoUrls: next.map((p) => p.storagePath) })
  }

  const addProof = (files: FileList | null) => {
    if (!files) return
    if (!employmentDocType) {
      setAiStatus('fail')
      setAiMessage('請先選擇文件類型（員工證、扣繳憑單或薪資單），再上傳。')
      return
    }
    proofs.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    const newProofs: ProofItem[] = Array.from(files)
      .slice(0, 1)
      .map((f) => ({
        id: `${Date.now()}-${f.name}`,
        name: f.name,
        type: f.type,
        file: f,
        previewUrl: URL.createObjectURL(f),
      }))
    setProofs(newProofs)
    setAiStatus('idle')
    setAiMessage('')
    employmentAiOutcomeRef.current = null
  }

  const removeProof = () => {
    proofs.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    setProofs([])
    setAiStatus('idle')
    setAiMessage('')
    employmentAiOutcomeRef.current = null
  }

  // Step index mapping differs by gender. Build helpers to check readiness.
  const photosReady  = photos.length >= PROFILE_PHOTO_MIN
  const jobReady     = proofs.length > 0
  // Income step is optional — advance even with nothing selected, but if the
  // user picks a tier they must also upload a doc.
  const incomeReady  = !selectedTier || (selectedTier !== null && incomeDoc !== null)

  const isLastStep  = step === steps.length - 1
  const canAdvance  = (() => {
    const label = steps[step]
    if (label === '生活照上傳')     return photosReady
    if (label === '職業驗證文件') {
      if (employmentSubmittedRef.current) return true
      const underDailyLimit = employmentDailyCount === null
        || employmentDailyCount < VERIFICATION_DAILY_SUBMIT_LIMIT
      return jobReady && underDailyLimit
    }
    if (label === '收入認證（選填）') {
      if (!incomeReady) return false
      if (selectedTier && incomeDoc) {
        return incomeDailyCount === null
          || incomeDailyCount < VERIFICATION_DAILY_SUBMIT_LIMIT
      }
      return true
    }
    return false
  })()

  /** 上傳並送審職業文件；送審成功即可進入收入步驟，不等待審核結果 */
  const submitEmploymentProof = async (
    setPhase?: (msg: string) => void,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!userId) return { ok: false, error: '請先登入。' }
    assertSubmitNotAborted(signal)
    if (employmentSubmittedRef.current) {
      const p = await getProfile(userId)
      assertSubmitNotAborted(signal)
      if (p?.verification_status === 'approved') return { ok: true }
      if (p?.verification_status === 'rejected') {
        employmentSubmittedRef.current = false
        return { ok: false, error: '職業驗證未通過，請重新上傳文件。' }
      }
      if (p?.verification_status === 'submitted') {
        return { ok: true }
      }
    }
    if (proofs.length === 0 || !proofs[0].file) {
      return { ok: false, error: '請上傳驗證文件。' }
    }

    const attemptBefore = await getTodayEmploymentVerificationSubmissionCount(userId)
    assertSubmitNotAborted(signal)
    if (attemptBefore >= VERIFICATION_DAILY_SUBMIT_LIMIT) {
      return { ok: false, error: `今天職業認證送審已達上限 ${VERIFICATION_DAILY_SUBMIT_LIMIT} 次，請明天再試。` }
    }
    const isLastAttempt = attemptBefore + 1 >= VERIFICATION_DAILY_SUBMIT_LIMIT

    const proofFile = proofs[0].file
    let aiForSubmit: AiResult | null = null

    if (proofFile.type.startsWith('image/')) {
      setPhase?.('AI 審核中…')
      const o = await fetchEmploymentAiOutcome(proofFile, employmentDocType || undefined, signal)
      assertSubmitNotAborted(signal)
      if (o) {
        aiForSubmit = {
          passed: o.passed,
          company: o.company,
          confidence: o.confidence,
          reason: o.reason,
        }
      }
    }

    const profile = await getProfile(userId)
    assertSubmitNotAborted(signal)
    const companyForSubmit = resolveEmploymentCompany(aiForSubmit?.company ?? null, profile?.company)
    const aiPassed = aiForSubmit?.passed === true

    setPhase?.('正在上傳文件…')
    const proofResult = await uploadProofDoc(userId, proofFile)
    assertSubmitNotAborted(signal)
    if (!proofResult.ok) {
      return { ok: false, error: proofResult.error ?? '文件上傳失敗，請再試一次。' }
    }

    const docType: DocType = employmentDocType || (
      proofFile.type === 'application/pdf' ? 'tax_return' : 'payslip'
    )

    const shouldSubmitForReview = (aiPassed && !!companyForSubmit) || isLastAttempt

    if (!shouldSubmitForReview) {
      const attemptResult = await submitVerificationDoc(
        userId,
        companyForSubmit,
        docType,
        proofResult.path,
        aiForSubmit ?? undefined,
        'manual',
        resolveManualReviewReason(aiForSubmit?.reason),
        { attemptOnly: true, status: 'rejected' },
      )
      if (!attemptResult.ok) {
        return { ok: false, error: attemptResult.error ?? '送審失敗，請稍後再試。' }
      }
      void getTodayEmploymentVerificationSubmissionCount(userId).then(setEmploymentDailyCount)
      setAiStatus('fail')
      setAiMessage(VERIFICATION_AI_PREFLIGHT_FAIL_USER_MESSAGE)
      return { ok: false, error: VERIFICATION_AI_PREFLIGHT_FAIL_USER_MESSAGE }
    }

    const reviewMode: 'ai_auto' | 'manual' = aiPassed ? 'ai_auto' : 'manual'
    setPhase?.('正在寫入送審紀錄…')
    const submitResult = await submitVerificationDoc(
      userId,
      companyForSubmit,
      docType,
      proofResult.path,
      aiForSubmit ?? undefined,
      reviewMode,
      aiPassed ? undefined : resolveManualReviewReason(aiForSubmit?.reason),
    )
    if (!submitResult.ok) {
      return { ok: false, error: submitResult.error ?? '送審失敗，請稍後再試。' }
    }

    employmentSubmittedRef.current = true
    setMaleVerifyGate('submitted')
    void getTodayEmploymentVerificationSubmissionCount(userId).then(setEmploymentDailyCount)
    if (!aiPassed || reviewMode === 'manual') {
      setAiStatus('ok')
      setAiMessage(VERIFICATION_MANUAL_REVIEW_USER_MESSAGE)
    }
    return { ok: true }
  }

  const advanceFromEmploymentStep = async () => {
    submissionInterruptReasonRef.current = null
    const ac = beginSubmissionAbortScope()
    setEmploymentManualWait(true)
    setEmploymentWaitMessage('正在送審…')
    try {
      const result = await submitEmploymentProof((msg) => setEmploymentWaitMessage(msg), ac.signal)
      if (result.ok) {
        abortActiveSubmission()
        setEmploymentManualWait(false)
        setStep((s) => s + 1)
        return
      }
      abortActiveSubmission()
      setEmploymentManualWait(false)
      setAiStatus('fail')
      setAiMessage(result.error ?? '送審失敗，請稍後再試。')
    } catch (err) {
      abortActiveSubmission()
      setEmploymentManualWait(false)
      setAiStatus('fail')
      if (err instanceof DOMException && err.name === 'AbortError') {
        setAiMessage(resolveSubmitAbortUserMessage())
        submissionInterruptReasonRef.current = null
        return
      }
      setAiMessage('送審失敗，請檢查網路後再試。')
    }
  }

  const handleSubmit = async (options?: { skipIncome?: boolean }) => {
    setSubmitting(true)
    try {
      if (!userId) {
        await new Promise((r) => setTimeout(r, 1200))
        onCompleteRef.current()
        return
      }

      const uploadedPhotoUrls = photos.map((p) => p.storagePath)
      if (uploadedPhotoUrls.length < PROFILE_PHOTO_MIN) {
        setAiStatus('fail')
        setAiMessage(`請至少成功上傳 ${PROFILE_PHOTO_MIN} 張生活照後再繼續。`)
        return
      }
      const profilePatch = await upsertProfile({ userId, photoUrls: uploadedPhotoUrls })
      if (!profilePatch.ok) {
        setAiStatus('fail')
        setAiMessage(profilePatch.error ?? '生活照儲存失敗，請再試一次。')
        return
      }

      // 選填：收入認證（送審後不等待審核；通過與否不影響進探索）
      if (!options?.skipIncome && selectedTier && incomeDoc) {
        const incomeSubmissions = await getTodayIncomeVerificationSubmissionCount(userId)
        if (incomeSubmissions >= VERIFICATION_DAILY_SUBMIT_LIMIT) {
          setAiStatus('fail')
          setAiMessage(`今天收入認證送審已達上限 ${VERIFICATION_DAILY_SUBMIT_LIMIT} 次，已略過，仍可進入探索。`)
        } else {
          submissionInterruptReasonRef.current = null
          const ac = beginSubmissionAbortScope()
          setIncomeApprovalWait(true)
          setIncomeApprovalWaitMessage('正在送審收入證明…')

          let extraAi: AiResult | undefined
          let reviewMode: 'ai_auto' | 'manual' = 'manual'
          let manualReason = `收入文件由人工審核。${VERIFICATION_MANUAL_REVIEW_TAIL}`

          try {
            if (incomeDoc.file.type.startsWith('image/')) {
              setIncomeApprovalWaitMessage('AI 正在辨識收入文件…')
              await fetchIncomeAiOutcome(incomeDoc.file, selectedTier, ac.signal)
              const boxed = incomeAiOutcomeRef.current
              if (boxed) {
                extraAi = boxed.aiResult
                reviewMode = boxed.reviewMode
                if (boxed.reviewMode === 'manual') {
                  manualReason = boxed.manualReason || manualReason
                }
              }
            }

            assertSubmitNotAborted(ac.signal)
            setIncomeApprovalWaitMessage('正在上傳並送審…')
            const r = await uploadProofDoc(userId, incomeDoc.file)
            assertSubmitNotAborted(ac.signal)
            if (!r.ok) {
              setAiStatus('fail')
              setAiMessage(r.error ?? '收入文件上傳失敗，仍可進入探索。')
            } else {
              const docType: DocType = incomeDoc.type === 'application/pdf' ? 'tax_return' : 'other'
              const incomeSubmit = await submitIncomeVerification(
                userId,
                selectedTier,
                docType,
                r.path,
                extraAi,
                reviewMode,
                reviewMode === 'manual'
                  ? resolveManualReviewReason(extraAi?.reason, manualReason)
                  : undefined,
              )
              if (!incomeSubmit.ok) {
                setAiStatus('fail')
                setAiMessage(incomeSubmit.error ?? '收入認證送審失敗，仍可進入探索。')
              } else {
                void getTodayIncomeVerificationSubmissionCount(userId).then(setIncomeDailyCount)
              }
            }
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              setAiStatus('fail')
              setAiMessage(resolveSubmitAbortUserMessage())
              submissionInterruptReasonRef.current = null
            } else {
              setAiStatus('fail')
              setAiMessage('收入認證送審失敗，仍可進入探索。')
            }
          } finally {
            abortActiveSubmission()
            setIncomeApprovalWait(false)
          }
        }
      }

      // 職業驗證須 approved 才可進探索
      if (gender === 'male') {
        let emStatus = (await getProfile(userId))?.verification_status ?? 'pending'
        if (emStatus === 'pending') {
          setAiStatus('fail')
          setAiMessage('請先完成職業驗證送審。')
          setStep(1)
          return
        }
        if (emStatus === 'rejected') {
          employmentSubmittedRef.current = false
          setAiStatus('fail')
          setAiMessage('職業驗證未通過，請重新上傳文件。')
          setStep(1)
          return
        }
        if (emStatus === 'submitted') {
          setEmploymentManualWait(true)
          setEmploymentWaitMessage('等待職業驗證通過…')
          const emResult = await waitForEmploymentApproval((msg) => setEmploymentWaitMessage(msg))
          setEmploymentManualWait(false)
          if (emResult.ok) {
            /* 繼續 onComplete */
          } else if (emResult.pendingManual) {
            setEmploymentReviewPendingHold(true)
            return
          } else {
            setAiStatus('fail')
            setAiMessage(emResult.error ?? '職業驗證未通過，請重新上傳文件。')
            setStep(1)
            return
          }
        }
      }

      onCompleteRef.current()
    } catch {
      setIncomeApprovalWait(false)
      setAiStatus('fail')
      setAiMessage('提交失敗，請檢查網路後再試。')
    } finally {
      setSubmitting(false)
    }
  }

  const stepLabel = steps[step]
  const isIncomeStep = stepLabel === '收入認證（選填）'
  const incomeTierSelected = selectedTier !== null

  if (gender === 'male' && maleVerifyGate === 'loading') {
    return (
      <div className="max-w-md mx-auto min-h-[50vh] flex flex-col items-center justify-center px-6 pt-safe pb-safe">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }} className="mb-4">
          <Cpu className="w-8 h-8 text-slate-400" />
        </motion.div>
        <p className="text-sm text-slate-500">載入驗證狀態…</p>
      </div>
    )
  }

  if (gender === 'male' && employmentReviewPendingHold) {
    return (
      <div className="max-w-md mx-auto min-h-[100dvh] bg-[#fafafa] flex flex-col px-6 pt-safe pb-safe">
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <ShieldCheck className="w-12 h-12 text-amber-500 mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">職業驗證審核中</h1>
          <p className="text-sm text-slate-600 leading-relaxed max-w-[300px]">
            已收到你的證明文件。通過審核後即可進入探索；若需人工複核，可能需要超過 12 小時。
          </p>
          <p className="text-xs text-slate-400 mt-4 max-w-[280px] leading-relaxed">
            審核期間你仍可修改個人資料或問卷，或先登出稍後再回來。
          </p>
        </div>
        <VerifyWaitActions
          onEditProfile={onEditProfile}
          onEditQuestionnaire={onEditQuestionnaire}
          onSignOut={onSignOut}
          className="mx-auto pb-2"
        />
      </div>
    )
  }

  return (
    <>
    <div className="max-w-md mx-auto bg-[#fafafa]">
      {/* Header */}
      <div className="px-5 pt-safe pb-5">
        <div className="flex items-center gap-3 mb-5">
          {step > 0 && (
            <button
              onClick={() => setStep(0)}
              className="w-8 h-8 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center flex-shrink-0"
            >
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
          )}
          <div className="flex-1">
            <div className="flex gap-1.5 mb-2">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1.5 flex-1 rounded-full transition-all duration-300',
                    i <= step ? 'bg-slate-900' : 'bg-slate-200',
                  )}
                />
              ))}
            </div>
            <p className="text-xs text-slate-400">{step + 1} / {steps.length} — {stepLabel}</p>
          </div>
        </div>

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
                {gender === 'female' && (
                  <p className="text-[11px] font-semibold text-indigo-600 mb-2">
                    已完成價值觀評估，請接著上傳生活照（至少 {PROFILE_PHOTO_MIN} 張）。
                  </p>
                )}
                <div className="flex items-center gap-2 mb-1">
                  <Camera className="w-4 h-4 text-slate-400" />
                  <h2 className="text-xl font-bold text-slate-900">上傳你的生活照</h2>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                  選擇照片後按「上傳這張照片」；通過審核後會寫入你的個人檔案。
                </p>
              </>
            )}
            {stepLabel === '職業驗證文件' && (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <h2 className="text-xl font-bold text-slate-900">身份驗證文件</h2>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                  請上傳任職證明文件，AI 會自動辨識。送審後可先填寫收入認證；<span className="font-semibold text-slate-600">職業驗證通過後</span>才可進入探索。
                </p>
                <p className="text-sm text-slate-500 leading-relaxed mt-2">
                  <span className="font-bold text-slate-800">您必須符合指定的頂尖企業</span>
                  正式員工，方可通過職業驗證。
                </p>
              </>
            )}
            {stepLabel === '收入認證（選填）' && (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <Gem className="w-4 h-4 text-slate-400" />
                  <h2 className="text-xl font-bold text-slate-900">收入認證</h2>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                  選填。通過與否不影響進入探索；每日最多送審 {VERIFICATION_DAILY_SUBMIT_LIMIT} 次。
                </p>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Form content */}
      <div className="flex-1 px-5 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22 }}
            className="space-y-4"
          >
            {/* ── Life photos ─────────────────────────────── */}
            {stepLabel === '生活照上傳' && userId && (
              <>
                <LifePhotoUploadSection
                  userId={userId}
                  photos={photos}
                  onPhotosChange={setPhotos}
                  onUploadSuccess={handleLifePhotoUploadSuccess}
                />

                <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-600">照片建議</p>
                  {['正面露臉、光線充足的單人近照', '避免團體照、墨鏡或口罩遮住臉部', '能展現個性與生活風格的日常照'].map((tip) => (
                    <div key={tip} className="flex items-start gap-2">
                      <div className="w-1 h-1 rounded-full bg-slate-400 mt-1.5 flex-shrink-0" />
                      <p className="text-xs text-slate-500">{tip}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {stepLabel === '生活照上傳' && !userId && (
              <p className="text-sm text-rose-600">請先登入後再上傳生活照。</p>
            )}

            {/* ── Employment proof (male only) ──────────────────────────── */}
            {stepLabel === '職業驗證文件' && (
              <>
                <input
                  ref={proofInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => addProof(e.target.files)}
                />

                {/* Accepted documents */}
                <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    接受的驗證文件（任選一種）
                  </p>
                  <div className="space-y-2">
                    {[
                      { icon: '🪪', label: '員工識別證照片', desc: '正反兩面清晰可見' },
                      { icon: '📄', label: '電子報稅單', desc: '顯示雇主名稱即可，收入可遮蓋' },
                      { icon: '💰', label: '薪資條截圖', desc: '含公司名稱與最近一個月' },
                    ].map(({ icon, label, desc }) => (
                      <div key={label} className="flex items-start gap-3 py-2">
                        <span className="text-lg">{icon}</span>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{label}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    文件類型 <span className="text-red-400">*</span>
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {EMPLOYMENT_DOC_TYPES.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setEmploymentDocType(value)
                          if (proofs.length > 0) removeProof()
                        }}
                        className={cn(
                          'rounded-xl border-2 px-3 py-2.5 text-left text-sm font-semibold transition-all',
                          employmentDocType === value
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-600',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                    上傳扣繳憑單或薪資單時請選對類型；AI 會以中文姓名比對，避免誤讀英文拼音。
                  </p>
                  {employmentDailyCount !== null && (
                    <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                      今日尚可送審{' '}
                      {Math.max(0, VERIFICATION_DAILY_SUBMIT_LIMIT - employmentDailyCount)} 次
                      （每日最多 {VERIFICATION_DAILY_SUBMIT_LIMIT} 次）
                    </p>
                  )}
                </div>

                {/* Upload area */}
                {proofs.length === 0 ? (
                  <button
                    onClick={() => {
                      if (!employmentDocType) {
                        setAiStatus('fail')
                        setAiMessage('請先選擇文件類型，再上傳。')
                        return
                      }
                      clickFileInputWithGrace(proofInputRef.current)
                    }}
                    className={cn(
                      'w-full rounded-3xl p-6 flex flex-col items-center gap-3 transition-all bg-white ring-1 shadow-sm hover:ring-slate-300',
                      employmentDocType ? 'ring-slate-100' : 'ring-amber-200 opacity-90',
                    )}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                      <Upload className="w-6 h-6 text-slate-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-slate-700">
                        上傳職業驗證文件
                      </p>
                      <p className="text-xs text-slate-400 mt-1">JPG / PNG / PDF · 送審後可繼續下一步</p>
                    </div>
                  </button>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-emerald-100 flex items-center gap-3"
                  >
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{proofs[0].name}</p>
                      <p className="text-xs text-emerald-500 mt-0.5">已選擇檔案，按繼續送審</p>
                    </div>
                    <button
                      onClick={removeProof}
                      className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                  </motion.div>
                )}

                {/* AI verification status — shown after full-screen review completes */}
                {aiStatus !== 'idle' && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      'rounded-2xl p-4 flex items-start gap-3',
                      aiStatus === 'ok'   && 'bg-emerald-50 ring-1 ring-emerald-100',
                      aiStatus === 'fail' && 'bg-red-50 ring-1 ring-red-100',
                    )}
                  >
                    {aiStatus === 'ok'   && <ShieldCheck className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />}
                    {aiStatus === 'fail' && <AlertCircle  className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5"    />}
                    <p className={cn(
                      'text-xs leading-relaxed',
                      aiStatus === 'ok'   && 'text-emerald-700 font-medium',
                      aiStatus === 'fail' && 'text-red-600',
                    )}>
                      {aiMessage}
                    </p>
                  </motion.div>
                )}

                {/* Privacy notice — prominent watermark-style */}
                <div className="relative bg-slate-900 rounded-2xl p-5 overflow-hidden">
                  {/* Decorative watermark text */}
                  <div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden"
                    aria-hidden
                  >
                    <span
                      className="text-white/[0.04] font-black text-5xl leading-none whitespace-nowrap rotate-[-12deg]"
                    >
                      PRIVACY PROTECTED
                    </span>
                  </div>

                  <div className="relative flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-white text-sm font-bold mb-1">隱私保護聲明</p>
                      <p className="text-white/60 text-xs leading-relaxed">
                        證件資料僅供真人審核，審核後系統自動物理刪除，不留存於數據庫。所有文件採用 AES-256 加密傳輸，不用於任何商業目的。
                      </p>
                    </div>
                  </div>
                </div>

                {/* Warning */}
                <div className="flex items-start gap-2 px-1">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-400 leading-relaxed">
                    僅限頂尖企業正式員工。文件不符資格將不予通過。
                  </p>
                </div>
              </>
            )}

            {/* ── Income verification (optional) ──────────────────── */}
            {stepLabel === '收入認證（選填）' && (
              <>
                <input
                  ref={incomeInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => addIncomeDoc(e.target.files)}
                />

                {/* Tier selection cards with live border preview */}
                <div className="space-y-3">
                  {TIER_CARDS.map(({ tier, range, desc }) => {
                    const isActive = selectedTier === tier
                    return (
                      <button
                        key={tier}
                        onClick={() => setSelectedTier(isActive ? null : tier)}
                        className={cn(
                          'w-full flex items-center gap-3 p-3 rounded-2xl text-left transition-all',
                          isActive
                            ? 'bg-white ring-2 ring-slate-900 shadow-md'
                            : 'bg-white ring-1 ring-slate-100 shadow-sm active:scale-[0.99]',
                        )}
                      >
                        {/* Live preview — a little square showing the border */}
                        <IncomeBorder tier={tier} radius="0.6rem" thickness={6}>
                          <div className="w-14 h-14 bg-slate-100 flex items-center justify-center">
                            <Gem className="w-5 h-5 text-slate-400" />
                          </div>
                        </IncomeBorder>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-900 leading-tight">
                            {tier === 'silver' ? '銀級' : tier === 'gold' ? '金級' : '鑽石級'}認證
                          </p>
                          <p className="text-[12px] text-slate-500 mt-0.5">{range}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>
                        </div>
                        <div
                          className={cn(
                            'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0',
                            isActive ? 'bg-slate-900' : 'bg-slate-100',
                          )}
                        >
                          {isActive && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* Document upload only after a tier is picked */}
                {selectedTier && (
                  <>
                    {incomeDailyCount !== null && (
                      <p className="text-[11px] text-slate-500 px-1 leading-relaxed">
                        今日尚可送審{' '}
                        {Math.max(0, VERIFICATION_DAILY_SUBMIT_LIMIT - incomeDailyCount)} 次
                        （每日最多 {VERIFICATION_DAILY_SUBMIT_LIMIT} 次）
                      </p>
                    )}
                    <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                        接受的收入證明（任選一種）
                      </p>
                      <div className="space-y-1.5">
                        {[
                          { icon: '🧾', label: '綜合所得稅結算申報書（最可信）' },
                          { icon: '💼', label: '薪資單 / 扣繳憑單' },
                          { icon: '🏦', label: '薪轉存摺 / 銀行對帳單' },
                        ].map(({ icon, label }) => (
                          <div key={label} className="flex items-center gap-2 py-0.5">
                            <span className="text-sm">{icon}</span>
                            <p className="text-xs text-slate-600">{label}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {incomeDoc === null ? (
                      <button
                        onClick={() => clickFileInputWithGrace(incomeInputRef.current)}
                        className="w-full rounded-3xl p-6 flex flex-col items-center gap-3 bg-white ring-1 ring-slate-100 shadow-sm active:scale-[0.99] transition-all"
                      >
                        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                          <Upload className="w-6 h-6 text-slate-400" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-semibold text-slate-700">
                            上傳{selectedTier === 'silver' ? '銀級' : selectedTier === 'gold' ? '金級' : '鑽石級'}證明文件
                          </p>
                          <p className="text-xs text-slate-400 mt-1">JPG / PNG / PDF</p>
                        </div>
                      </button>
                    ) : (
                      <div className="space-y-3">
                        {/* Preview */}
                        <div className="bg-white rounded-2xl p-3 shadow-sm ring-1 ring-slate-100">
                          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 px-1">
                            預覽
                          </p>
                          {incomeDoc.type.startsWith('image/') ? (
                            <div className="relative w-full rounded-xl overflow-hidden bg-slate-100" style={{ aspectRatio: '4 / 3' }}>
                              <img
                                src={incomeDoc.previewUrl}
                                alt="收入證明預覽"
                                className="w-full h-full object-contain"
                                style={{ filter: 'blur(6px)' }}
                              />
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="bg-white/85 backdrop-blur-sm rounded-full px-3 py-1.5">
                                  <p className="text-[11px] font-bold text-slate-700 tracking-wide">
                                    隱私保護預覽
                                  </p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-xl bg-slate-50 p-4 flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center">
                                <FileText className="w-5 h-5 text-slate-500" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">{incomeDoc.name}</p>
                                <p className="text-[11px] text-slate-400 mt-0.5">PDF 文件 · 已準備上傳</p>
                              </div>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={clearIncomeDoc}
                          className="w-full py-2.5 text-xs text-slate-400 bg-slate-50 rounded-xl"
                        >
                          重新選擇檔案
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* Privacy & review notes */}
                <div className="flex items-start gap-2 px-1">
                  <Sparkles className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-400 leading-relaxed">
                    通過審核後，你可以到「編輯個人資訊」自行決定是否要顯示收入皇冠。未通過前皇冠不會顯示。
                  </p>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="px-5 pb-10 pt-4 space-y-3">
        {isLastStep && aiStatus === 'fail' && aiMessage && (
          <div className="rounded-2xl p-3 bg-red-50 ring-1 ring-red-100 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-600 leading-relaxed">{aiMessage}</p>
          </div>
        )}
        {isIncomeStep && !incomeTierSelected ? (
          <motion.button
            whileTap={{ scale: submitting ? 1 : 0.97 }}
            onClick={() => void handleSubmit({ skipIncome: true })}
            disabled={submitting || employmentManualWait || incomeApprovalWait}
            className={cn(
              'w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 transition-all',
              submitting || employmentManualWait || incomeApprovalWait
                ? 'bg-slate-100 text-slate-300'
                : 'bg-slate-900 text-white shadow-lg shadow-slate-900/20',
            )}
          >
            {submitting ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                >
                  <Cpu className="w-5 h-5" />
                </motion.div>
                提交中⋯
              </>
            ) : (
              '略過，之後再上傳'
            )}
          </motion.button>
        ) : (
          <>
            <motion.button
              whileTap={{ scale: canAdvance ? 0.97 : 1 }}
              onClick={async () => {
                if (!canAdvance || submitting) return
                if (isLastStep) {
                  await handleSubmit()
                } else if (stepLabel === '職業驗證文件') {
                  await advanceFromEmploymentStep()
                } else {
                  setStep(step + 1)
                }
              }}
              disabled={submitting || !canAdvance || employmentManualWait || incomeApprovalWait}
              className={cn(
                'w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 transition-all',
                canAdvance && !submitting
                  ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20'
                  : 'bg-slate-100 text-slate-300',
              )}
            >
              {submitting ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                  >
                    <Cpu className="w-5 h-5" />
                  </motion.div>
                  提交中⋯
                </>
              ) : (
                <>
                  {isLastStep
                    ? (isIncomeStep && incomeTierSelected ? '送審並進入探索' : '完成並進入探索')
                    : '繼續'}
                  <ChevronRight className="w-5 h-5" />
                </>
              )}
            </motion.button>
            {isIncomeStep && incomeTierSelected && (
              <button
                type="button"
                onClick={() => void handleSubmit({ skipIncome: true })}
                disabled={submitting || employmentManualWait || incomeApprovalWait}
                className={cn(
                  'w-full rounded-2xl py-3.5 font-semibold text-sm transition-all',
                  submitting || employmentManualWait || incomeApprovalWait
                    ? 'text-slate-300'
                    : 'text-slate-600 active:scale-[0.98]',
                )}
              >
                略過，之後再上傳
              </button>
            )}
          </>
        )}
      </div>
    </div>
    {employmentManualWait
      ? createPortal(
          <div className="fixed inset-0 z-[200] bg-[#fafafa] flex flex-col px-6 pt-safe pb-safe">
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                className="mb-5"
              >
                <Cpu className="w-10 h-10 text-slate-400" />
              </motion.div>
              <p className="text-lg font-bold text-slate-900 mb-2">{employmentWaitMessage}</p>
              <p className="text-sm text-slate-600 leading-relaxed max-w-[300px]">
                {employmentWaitMessage.startsWith('等待職業驗證')
                  ? '文件已收到，通過後會自動進入探索；若需人工複核，可能需要超過 12 小時。'
                  : '請暫留此頁直到自動進入下一步。這是送審進行中，並非已收到文件的審核等待。'}
              </p>
            </div>
            <VerifyWaitActions
              onEditProfile={onEditProfile}
              onEditQuestionnaire={onEditQuestionnaire}
              onSignOut={onSignOut}
              className="mx-auto pb-2"
            />
          </div>,
          document.body,
        )
      : null}
    {incomeApprovalWait
      ? createPortal(
          <div className="fixed inset-0 z-[200] bg-[#fafafa] flex flex-col px-6 pt-safe pb-safe">
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                className="mb-5"
              >
                <Cpu className="w-10 h-10 text-slate-400" />
              </motion.div>
              <p className="text-lg font-bold text-slate-900 mb-2">{incomeApprovalWaitMessage}</p>
              <p className="text-sm text-slate-600 leading-relaxed max-w-[300px]">
                請暫留此頁直到處理完成；收入審核結果不影響進入探索。
              </p>
            </div>
            <VerifyWaitActions
              onEditProfile={onEditProfile}
              onEditQuestionnaire={onEditQuestionnaire}
              onSignOut={onSignOut}
              className="mx-auto pb-2"
            />
          </div>,
          document.body,
        )
      : null}
    </>
  )
}
