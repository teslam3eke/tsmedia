import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Camera, FileText, Trash2, ChevronRight, ChevronLeft,
  ShieldCheck, AlertCircle, Cpu, Upload, Gem, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  uploadProofDoc, submitVerificationDoc,
  submitIncomeVerification, upsertProfile, getTodayVerificationSubmissionCount,
  getProfile, finalizeDueAiReviews, resolvePhotoUrls,
  type AiResult,
} from '@/lib/db'
import { parseCompany, resolveEmploymentCompany, sanitizeVerificationUserMessage } from '@/lib/companyDisplay'
import { PROFILE_PHOTO_MIN, PROFILE_PHOTO_MAX, type Company, type DocType, type IncomeTier, type VerificationStatus } from '@/lib/types'
import { IncomeBorder } from '@/components/IncomeBorder'
import { AI_AUTO_REVIEW_UI_SECONDS } from '@/lib/aiReviewConstants'
import { clickFileInputWithGrace } from '@/lib/resumeHardReload'
import { LifePhotoUploadSection, type LifePhotoSlot } from '@/components/LifePhotoUploadSection'

interface Props {
  userId?: string
  claimedName?: string | null
  gender?: 'male' | 'female'
  onComplete: () => void
  onSkip: () => void
}

interface ProofItem {
  id: string
  name: string
  type: string
  file: File
  previewUrl: string   // object URL for in-app preview
}

const STEPS_MALE   = ['生活照上傳', '職業驗證文件', '收入認證（選填）']
/** 女生 onboarding 僅生活照；收入／薪資認證改由站內「編輯個人資訊」處理 */
const STEPS_FEMALE = ['生活照上傳']

const TIER_CARDS: { tier: IncomeTier; range: string; desc: string }[] = [
  { tier: 'silver',  range: '200萬+', desc: '銀皇冠標章' },
  { tier: 'gold',    range: '300萬+', desc: '金皇冠標章' },
  { tier: 'diamond', range: '400萬+', desc: '鑽石皇冠標章' },
]
export default function IdentityVerifyScreen({ userId, claimedName, gender = 'male', onComplete, onSkip }: Props) {
  const steps = gender === 'female' ? STEPS_FEMALE : STEPS_MALE
  const [step, setStep] = useState(0)
  const [photos, setPhotos] = useState<LifePhotoSlot[]>([])
  const [proofs, setProofs] = useState<ProofItem[]>([])
  const [submitting, setSubmitting] = useState(false)

  // ── Income verification state ────────────────────────────────────
  const [selectedTier, setSelectedTier] = useState<IncomeTier | null>(null)
  const [incomeDoc, setIncomeDoc]       = useState<ProofItem | null>(null)

  // ── AI verification state ────────────────────────────────────────
  const [aiStatus,     setAiStatus]     = useState<'idle' | 'ok' | 'fail'>('idle')
  const [aiMessage,    setAiMessage]    = useState('')
  const [aiResultData, setAiResultData] = useState<{ passed: boolean; company: Company | null; confidence: 'high' | 'medium' | 'low' | null; reason: string | null } | null>(null)

  type IncomeRunningHold = { phase: 'running'; countdown: number }
  const [incomeHold, setIncomeHold] = useState<IncomeRunningHold | null>(null)

  /** 男性：非 approved 時阻擋進主殼；submitted 顯示審核中並輪詢 finalize */
  const [maleVerifyGate, setMaleVerifyGate] = useState<VerificationStatus | 'loading' | null>(
    gender === 'male' && userId ? 'loading' : null,
  )
  /** 職業步驟：人工審核中，通過後自動進收入頁 */
  const [employmentManualWait, setEmploymentManualWait] = useState(false)
  /** employmentManualWait overlay 動態訊息 */
  const [employmentWaitMessage, setEmploymentWaitMessage] = useState('職業驗證審核中')

  /** 職業文件已在步驟 2 送審；最後一步勿重複上傳 */
  const employmentSubmittedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (!userId) {
      setPhotos([])
      if (gender !== 'male') setMaleVerifyGate(null)
      return
    }
    let cancelled = false
    void (async () => {
      const p = await getProfile(userId)
      if (cancelled || !p) return

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
          setStep(1)
          setEmploymentManualWait(true)
          setEmploymentWaitMessage('職業驗證審核中')
          void (async () => {
            const result = await waitForEmploymentApproval((msg) => setEmploymentWaitMessage(msg))
            if (result.ok) {
              setEmploymentManualWait(false)
              setStep(2)
            } else if (result.error) {
              setEmploymentManualWait(false)
              setMaleVerifyGate('rejected')
              setAiStatus('fail')
              setAiMessage(result.error)
            }
          })()
        }
      } else {
        setMaleVerifyGate(null)
      }
    })()
    return () => { cancelled = true }
  }, [userId, gender])

  /** 重新進入（step 0）且仍 submitted：輪詢直到 approved 再進主殼 */
  useEffect(() => {
    if (gender !== 'male' || !userId || maleVerifyGate !== 'submitted') return
    if (step !== 0 || employmentManualWait) return
    let cancelled = false
    const tick = async () => {
      await finalizeDueAiReviews()
      const p = await getProfile(userId)
      if (cancelled) return
      const st = p?.verification_status ?? 'submitted'
      if (st === 'approved') {
        employmentSubmittedRef.current = true
        setMaleVerifyGate('approved')
        onCompleteRef.current()
        return
      }
      if (st === 'rejected') setMaleVerifyGate('rejected')
    }
    void tick()
    const iv = window.setInterval(() => void tick(), 4000)
    return () => {
      cancelled = true
      window.clearInterval(iv)
    }
  }, [gender, userId, maleVerifyGate, step, employmentManualWait])

  const waitForEmploymentApproval = async (
    setPhase?: (msg: string) => void,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!userId) return { ok: false, error: '請先登入。' }
    setPhase?.('等待審核通過…')
    while (true) {
      await finalizeDueAiReviews()
      const p = await getProfile(userId)
      if (p?.verification_status === 'approved') {
        setMaleVerifyGate('approved')
        return { ok: true }
      }
      if (p?.verification_status === 'rejected') {
        employmentSubmittedRef.current = false
        return { ok: false, error: '職業驗證未通過，請重新上傳文件。' }
      }
      await new Promise((r) => setTimeout(r, 800))
    }
  }

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
  const incomeHoldResolveRef = useRef<(() => void) | null>(null)

  const proofInputRef  = useRef<HTMLInputElement>(null)
  const incomeInputRef = useRef<HTMLInputElement>(null)

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const fetchEmploymentAiOutcome = async (file: File) => {
    employmentAiOutcomeRef.current = null
    try {
      const imageBase64 = await fileToBase64(file)
      const docTypeHint: 'employee_id' | 'tax_return' | 'other' =
        file.type === 'application/pdf' ? 'tax_return' : file.type.startsWith('image/') ? 'employee_id' : 'other'
      const res = await fetch('/api/verify-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          verificationKind: 'employment',
          claimedName: claimedName?.trim() || undefined,
          docType: docTypeHint,
        }),
      })
      const data = await res.json() as { ok: boolean; company?: string; confidence?: string; message: string; reason?: string }
      const aiCompany = parseCompany(data.company)
      const aiConf = (data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low') ? data.confidence : null
      employmentAiOutcomeRef.current = {
        passed: data.ok,
        message: sanitizeVerificationUserMessage(data.message),
        company: aiCompany,
        confidence: aiConf,
        reason: data.reason ? sanitizeVerificationUserMessage(data.reason) : null,
      }
    } catch {
      employmentAiOutcomeRef.current = {
        passed: false,
        message: 'AI 暫時無法完成審核，已轉人工審核。',
        company: null,
        confidence: null,
        reason: 'AI 暫時無法完成審核，已轉人工審核。',
      }
    }
  }

  const fetchIncomeAiOutcome = async (file: File, tier: IncomeTier) => {
    incomeAiOutcomeRef.current = null
    try {
      const imageBase64 = await fileToBase64(file)
      const res = await fetch('/api/verify-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          verificationKind: 'income',
          claimedIncomeTier: tier,
          claimedName: claimedName?.trim() || undefined,
          docType: 'other',
        }),
      })
      const data = await res.json() as { ok: boolean; confidence?: string; message: string; reason?: string }
      const aiConf = (data.confidence === 'high' || data.confidence === 'medium' || data.confidence === 'low')
        ? data.confidence
        : null
      const aiResult: AiResult = {
        passed: data.ok,
        company: null,
        confidence: aiConf,
        reason: sanitizeVerificationUserMessage(data.reason ?? data.message),
      }
      incomeAiOutcomeRef.current = {
        aiResult,
        reviewMode: data.ok ? 'ai_auto' : 'manual',
        manualReason: data.ok ? '' : (aiResult.reason ?? 'AI 未通過，已轉人工審核。人工審核時間可能大於 12 小時。'),
      }
    } catch {
      incomeAiOutcomeRef.current = {
        aiResult: {
          passed: false,
          company: null,
          confidence: null,
          reason: 'AI 暫時無法完成審核，已轉人工審核。人工審核時間可能大於 12 小時。',
        },
        reviewMode: 'manual',
        manualReason: 'AI 暫時無法完成審核，已轉人工審核。人工審核時間可能大於 12 小時。',
      }
    }
  }

  useEffect(() => {
    if (!incomeHold || incomeHold.phase !== 'running') return
    if (incomeHold.countdown <= 0) return
    const t = window.setTimeout(() => {
      setIncomeHold((h) =>
        h ? { ...h, countdown: h.countdown - 1 } : h,
      )
    }, 1000)
    return () => window.clearTimeout(t)
  }, [incomeHold])

  useEffect(() => {
    if (!incomeHold || incomeHold.phase !== 'running' || incomeHold.countdown !== 0) return
    let cancelled = false
    ;(async () => {
      while (!incomeAiOutcomeRef.current && !cancelled) {
        await new Promise((r) => setTimeout(r, 80))
      }
      if (cancelled) return
      incomeHoldResolveRef.current?.()
      incomeHoldResolveRef.current = null
      setIncomeHold(null)
    })()
    return () => { cancelled = true }
  }, [incomeHold])

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
    setAiResultData(null)
    employmentAiOutcomeRef.current = null
    const file = newProofs[0]?.file
    if (file?.type.startsWith('image/')) {
      void fetchEmploymentAiOutcome(file)
    }
  }

  const removeProof = () => {
    proofs.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    setProofs([])
    setAiStatus('idle')
    setAiMessage('')
    setAiResultData(null)
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
    if (label === '職業驗證文件')   return jobReady
    if (label === '收入認證（選填）') return incomeReady
    return false
  })()

  /** 上傳並送審職業文件；輪詢直到 approved 或 rejected */
  const submitEmploymentProof = async (
    setPhase?: (msg: string) => void,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!userId) return { ok: false, error: '請先登入。' }
    if (employmentSubmittedRef.current) {
      const p = await getProfile(userId)
      if (p?.verification_status === 'approved') return { ok: true }
      if (p?.verification_status === 'rejected') {
        employmentSubmittedRef.current = false
        return { ok: false, error: '職業驗證未通過，請重新上傳文件。' }
      }
      if (p?.verification_status === 'submitted') {
        return waitForEmploymentApproval(setPhase)
      }
    }
    if (proofs.length === 0 || !proofs[0].file) {
      return { ok: false, error: '請上傳驗證文件。' }
    }

    const submissionCount = await getTodayVerificationSubmissionCount(userId)
    if (submissionCount >= 20) {
      return { ok: false, error: '今天已達送審上限 20 次，請明天再試。' }
    }

    const proofFile = proofs[0].file
    let aiForSubmit = aiResultData

    if (proofFile.type.startsWith('image/')) {
      setPhase?.('AI 審核中…')
      if (!employmentAiOutcomeRef.current) {
        await fetchEmploymentAiOutcome(proofFile)
      }
      const o = employmentAiOutcomeRef.current
      if (o) {
        aiForSubmit = {
          passed: o.passed,
          company: o.company,
          confidence: o.confidence,
          reason: o.reason,
        }
        setAiResultData(aiForSubmit)
        if (o.passed) {
          setAiStatus('ok')
          setAiMessage(o.message)
        } else {
          setAiStatus('fail')
          setAiMessage(`${o.message}。已轉人工審核，人工審核時間可能大於 12 小時。`)
        }
      }
    } else {
      setAiStatus('ok')
      setAiMessage('PDF 文件將由人工審核確認')
      aiForSubmit = null
    }

    const profile = await getProfile(userId)
    const companyForSubmit = resolveEmploymentCompany(aiForSubmit?.company ?? null, profile?.company)
    if (!companyForSubmit) {
      return {
        ok: false,
        error: proofFile.type.startsWith('image/')
          ? 'AI 無法判定任職公司，請確認文件含清楚的公司名稱後再試。'
          : '請先上傳圖片格式文件以便 AI 判定任職公司；PDF 需待 AI 或人工辨識後才能送審。',
      }
    }

    setPhase?.('正在上傳文件…')
    const proofResult = await uploadProofDoc(userId, proofFile)
    if (!proofResult.ok) {
      return { ok: false, error: proofResult.error ?? '文件上傳失敗，請再試一次。' }
    }

    const docTypeMap: Record<string, DocType> = {
      'image/jpeg': 'employee_id', 'image/png': 'employee_id',
      'image/heic': 'employee_id', 'application/pdf': 'tax_return',
    }
    const docType: DocType = docTypeMap[proofs[0].type] ?? 'payslip'
    const submitResult = await submitVerificationDoc(
      userId,
      companyForSubmit,
      docType,
      proofResult.path,
      aiForSubmit ?? undefined,
      aiForSubmit?.passed ? 'ai_auto' : 'manual',
      aiForSubmit?.passed ? undefined : 'AI 未通過或逾時，已轉人工審核。人工審核時間可能大於 12 小時。',
    )
    if (!submitResult.ok) {
      return { ok: false, error: submitResult.error ?? '送審失敗，請稍後再試。' }
    }

    employmentSubmittedRef.current = true
    setMaleVerifyGate('submitted')
    return waitForEmploymentApproval(setPhase)
  }

  const advanceFromEmploymentStep = async () => {
    setEmploymentManualWait(true)
    setEmploymentWaitMessage('正在處理…')
    try {
      const result = await submitEmploymentProof((msg) => setEmploymentWaitMessage(msg))
      if (result.ok) {
        setEmploymentManualWait(false)
        setStep((s) => s + 1)
        return
      }
      setEmploymentManualWait(false)
      setAiStatus('fail')
      setAiMessage(result.error ?? '送審失敗，請稍後再試。')
    } catch {
      setEmploymentManualWait(false)
      setAiStatus('fail')
      setAiMessage('送審失敗，請檢查網路後再試。')
    }
  }

  const handleSubmit = async () => {
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

      // 職業應已在步驟 2 完成；若尚未 approved 則擋下
      if (gender === 'male') {
        const p = await getProfile(userId)
        if (p?.verification_status !== 'approved') {
          setAiStatus('fail')
          setAiMessage('請先完成並通過職業驗證後再繼續。')
          return
        }
      }

      // 選填：收入認證
      if (selectedTier && incomeDoc) {
        const submissionCount = await getTodayVerificationSubmissionCount(userId)
        if (submissionCount >= 20) {
          setAiStatus('fail')
          setAiMessage('今天已達送審上限 20 次，請明天再試。')
          return
        }

        let extraAi: AiResult | undefined
        let reviewMode: 'ai_auto' | 'manual' = 'manual'
        let manualReason = '收入文件由人工審核。人工審核時間可能大於 12 小時。'

        if (incomeDoc.file.type.startsWith('image/')) {
          incomeAiOutcomeRef.current = null
          void fetchIncomeAiOutcome(incomeDoc.file, selectedTier)
          setIncomeHold({ phase: 'running', countdown: AI_AUTO_REVIEW_UI_SECONDS })
          await new Promise<void>((resolve) => {
            incomeHoldResolveRef.current = resolve
          })
          const boxed = incomeAiOutcomeRef.current as {
            aiResult: AiResult
            reviewMode: 'ai_auto' | 'manual'
            manualReason: string
          } | null
          if (boxed) {
            extraAi = boxed.aiResult
            reviewMode = boxed.reviewMode
            if (boxed.reviewMode === 'manual') {
              manualReason = boxed.manualReason || manualReason
            }
          }
        }

        const r = await uploadProofDoc(userId, incomeDoc.file)
        if (!r.ok) {
          setAiStatus('fail')
          setAiMessage(r.error ?? '收入文件上傳失敗，請再試一次。')
          return
        }
        const docType: DocType = incomeDoc.type === 'application/pdf' ? 'tax_return' : 'other'
        const incomeSubmit = await submitIncomeVerification(
          userId,
          selectedTier,
          docType,
          r.path,
          extraAi,
          reviewMode,
          reviewMode === 'manual'
            ? (manualReason || 'AI 未通過或逾時，已轉人工審核。人工審核時間可能大於 12 小時。')
            : undefined,
        )
        if (!incomeSubmit.ok) {
          setAiStatus('fail')
          setAiMessage(incomeSubmit.error ?? '收入認證送審失敗，請稍後再試。')
          return
        }
      }

      onCompleteRef.current()
    } catch {
      setAiStatus('fail')
      setAiMessage('提交失敗，請檢查網路後再試。')
    } finally {
      setSubmitting(false)
    }
  }

  const stepLabel = steps[step]

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

  if (gender === 'male' && maleVerifyGate === 'submitted' && step === 0 && !employmentManualWait) {
    return (
      <div className="max-w-md mx-auto min-h-[100dvh] bg-[#fafafa] flex flex-col items-center justify-center px-6 pt-safe pb-safe text-center">
        <ShieldCheck className="w-12 h-12 text-amber-500 mb-4" />
        <h1 className="text-xl font-bold text-slate-900 mb-2">職業驗證審核中</h1>
        <p className="text-sm text-slate-600 leading-relaxed mb-8 max-w-[300px]">
          已收到你的證明文件。通過審核後即可使用探索、聊天等功能；若需人工複核，可能需要超過 12 小時。
        </p>
        {import.meta.env.DEV && (
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-slate-400 underline underline-offset-2"
          >
            略過（測試）
          </button>
        )}
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
                  請上傳任職證明文件，AI 會自動辨識並完成公司驗證。
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
                  選擇對應的收入等級並上傳證明文件，通過審核後可啟用照片皇冠特效。此步驟為選填。
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

                {/* Upload area */}
                {proofs.length === 0 ? (
                  <button
                    onClick={() => clickFileInputWithGrace(proofInputRef.current)}
                    className="w-full rounded-3xl p-6 flex flex-col items-center gap-3 transition-all bg-white ring-1 ring-slate-100 shadow-sm hover:ring-slate-300"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                      <Upload className="w-6 h-6 text-slate-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-slate-700">
                        上傳職業驗證文件
                      </p>
                      <p className="text-xs text-slate-400 mt-1">JPG / PNG / PDF · 送出後會等待審核完成</p>
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
                      <p className="text-xs text-emerald-500 mt-0.5">✓ 文件已上傳</p>
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
                    僅限頂尖企業正式員工。文件不符資格將不予通過；審核約 1–3 個工作天。
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
          disabled={submitting || !canAdvance || employmentManualWait}
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
                ? (stepLabel === '收入認證（選填）' && !selectedTier ? '完成（略過收入認證）' : '提交審核申請')
                : '繼續'}
              <ChevronRight className="w-5 h-5" />
            </>
          )}
        </motion.button>

        {gender !== 'female' && import.meta.env.DEV && (
        <button type="button" onClick={onSkip} className="w-full text-slate-400 text-sm py-2">
          跳過（測試模式）
        </button>
        )}
      </div>
    </div>
    {employmentManualWait
      ? createPortal(
          <div className="fixed inset-0 z-[200] bg-[#fafafa] flex flex-col items-center justify-center px-6 pt-safe pb-safe text-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              className="mb-5"
            >
              <Cpu className="w-10 h-10 text-slate-400" />
            </motion.div>
            <p className="text-lg font-bold text-slate-900 mb-2">{employmentWaitMessage}</p>
            <p className="text-sm text-slate-600 leading-relaxed max-w-[300px]">
              審核完成後會自動進入下一步；若需人工複核，可能需要超過 12 小時。請稍候，不要關閉此頁面。
            </p>
          </div>,
          document.body,
        )
      : null}
    {incomeHold
      ? createPortal(
          <div className="fixed inset-0 z-[200] bg-[#fafafa]/95 backdrop-blur-sm flex flex-col items-center justify-center px-6 pt-safe pb-safe">
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }} className="mb-5">
              <Cpu className="w-10 h-10 text-slate-400" />
            </motion.div>
            <p className="text-lg font-bold text-slate-900 mb-2">收入證明 AI 審核</p>
            <p className="text-5xl font-black text-slate-900 tabular-nums mb-3">{incomeHold.countdown}</p>
            <p className="text-sm text-slate-500 text-center leading-relaxed max-w-[280px]">
              送出後即開始辨識；倒數結束後會繼續上傳並送出審核。
            </p>
          </div>,
          document.body,
        )
      : null}
    </>
  )
}
