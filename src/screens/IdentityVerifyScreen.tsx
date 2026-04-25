import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Camera, FileText, Trash2, ChevronRight, ChevronLeft,
  ShieldCheck, AlertCircle, Cpu, Upload, ImageIcon, Gem, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  uploadPhoto, uploadProofDoc, submitVerificationDoc,
  submitIncomeVerification, upsertProfile,
} from '@/lib/db'
import type { DocType, IncomeTier } from '@/lib/types'
import { IncomeBorder } from '@/components/IncomeBorder'

interface Props {
  userId?: string
  gender?: 'male' | 'female'
  onComplete: () => void
  onSkip: () => void
}

interface PhotoItem {
  id: string
  url: string
  name: string
  file: File
}

interface ProofItem {
  id: string
  name: string
  type: string
  file: File
  previewUrl: string   // object URL for in-app preview
}

const STEPS_MALE   = ['生活照上傳', '職業驗證文件', '收入認證（選填）']
const STEPS_FEMALE = ['生活照上傳', '收入認證（選填）']

const TIER_CARDS: { tier: IncomeTier; range: string; desc: string }[] = [
  { tier: 'silver',  range: '年收 200–299 萬', desc: '銀色金屬漸層邊框' },
  { tier: 'gold',    range: '年收 300–399 萬', desc: '溫暖香檳金漸層邊框' },
  { tier: 'diamond', range: '年收 400 萬以上', desc: '動態彩虹折射光效' },
]

export default function IdentityVerifyScreen({ userId, gender = 'male', onComplete, onSkip }: Props) {
  const steps = gender === 'female' ? STEPS_FEMALE : STEPS_MALE
  const [step, setStep] = useState(0)
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [proofs, setProofs] = useState<ProofItem[]>([])
  const [selectedCompany, setSelectedCompany] = useState<'TSMC' | 'MediaTek' | ''>('')
  const [submitting, setSubmitting] = useState(false)

  // ── Income verification state ────────────────────────────────────
  const [selectedTier, setSelectedTier] = useState<IncomeTier | null>(null)
  const [incomeDoc, setIncomeDoc]       = useState<ProofItem | null>(null)

  const photoInputRef  = useRef<HTMLInputElement>(null)
  const proofInputRef  = useRef<HTMLInputElement>(null)
  const incomeInputRef = useRef<HTMLInputElement>(null)

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

  const addPhotos = (files: FileList | null) => {
    if (!files) return
    const newPhotos: PhotoItem[] = Array.from(files)
      .slice(0, 5 - photos.length)
      .map((f) => ({
        id: `${Date.now()}-${f.name}`,
        url: URL.createObjectURL(f),
        name: f.name,
        file: f,
      }))
    setPhotos((prev) => [...prev, ...newPhotos].slice(0, 5))
  }

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const removed = prev.find((p) => p.id === id)
      if (removed) URL.revokeObjectURL(removed.url)
      return prev.filter((p) => p.id !== id)
    })
  }

  const addProof = (files: FileList | null) => {
    if (!files) return
    // Revoke any existing preview URL before replacing
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
  }

  const removeProof = () => {
    proofs.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    setProofs([])
  }

  // Step index mapping differs by gender. Build helpers to check readiness.
  const photosReady  = photos.length >= 3
  const jobReady     = selectedCompany !== '' && proofs.length > 0
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

  const handleSubmit = async () => {
    setSubmitting(true)

    if (userId) {
      // 1. Upload life photos to Storage (both genders)
      const photoFiles = photos.map((p) => p.file).filter(Boolean) as File[]
      const uploadedPhotoUrls: string[] = []
      for (const file of photoFiles) {
        const result = await uploadPhoto(userId, file)
        if (result.ok) uploadedPhotoUrls.push(result.path)
      }
      if (uploadedPhotoUrls.length > 0) {
        await upsertProfile({ userId, photoUrls: uploadedPhotoUrls })
      }

      // 2. Male-only: employment proof
      if (selectedCompany && proofs.length > 0 && proofs[0].file) {
        const proofResult = await uploadProofDoc(userId, proofs[0].file)
        if (proofResult.ok) {
          const docTypeMap: Record<string, DocType> = {
            'image/jpeg': 'employee_id', 'image/png': 'employee_id',
            'image/heic': 'employee_id', 'application/pdf': 'tax_return',
          }
          const docType: DocType = docTypeMap[proofs[0].type] ?? 'payslip'
          await submitVerificationDoc(userId, selectedCompany, docType, proofResult.path)
        }
      }

      // 3. Optional: income verification (both genders)
      if (selectedTier && incomeDoc) {
        const r = await uploadProofDoc(userId, incomeDoc.file)
        if (r.ok) {
          const docType: DocType = incomeDoc.type === 'application/pdf' ? 'tax_return' : 'other'
          await submitIncomeVerification(userId, selectedTier, docType, r.path)
        }
      }
    } else {
      // Offline / guest mode — just wait briefly
      await new Promise((r) => setTimeout(r, 1200))
    }

    setSubmitting(false)
    onComplete()
  }

  const stepLabel = steps[step]

  return (
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
                <div className="flex items-center gap-2 mb-1">
                  <Camera className="w-4 h-4 text-slate-400" />
                  <h2 className="text-xl font-bold text-slate-900">上傳你的生活照</h2>
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">
                  請上傳 3–5 張能展現真實生活風格的照片，所有照片必須是近期本人。
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
                  TsMedia 限台積電（TSMC）或聯發科（MediaTek）員工，請提供以下任一文件。
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
                  選擇對應的收入等級並上傳證明文件，通過審核後可啟用照片邊框特效。此步驟為選填。
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
            {stepLabel === '生活照上傳' && (
              <>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => addPhotos(e.target.files)}
                />

                {/* Photo grid */}
                {photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((photo) => (
                      <motion.div
                        key={photo.id}
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="relative aspect-square rounded-2xl overflow-hidden bg-slate-100"
                      >
                        <img
                          src={photo.url}
                          alt={photo.name}
                          className="w-full h-full object-cover scale-110"
                          style={{ filter: 'blur(6px)' }}
                        />
                        <div className="absolute inset-0 bg-black/10" />
                        <div className="absolute left-2 right-2 bottom-2 rounded-xl bg-white/80 backdrop-blur-sm px-2.5 py-1.5">
                          <p className="text-[10px] font-semibold text-slate-700 text-center tracking-wide">
                            隱私保護預覽
                          </p>
                        </div>
                        <button
                          onClick={() => removePhoto(photo.id)}
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center"
                        >
                          <Trash2 className="w-3 h-3 text-white" />
                        </button>
                      </motion.div>
                    ))}

                    {/* Add more slot */}
                    {photos.length < 5 && (
                      <button
                        onClick={() => photoInputRef.current?.click()}
                        className="aspect-square rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-1 bg-white hover:border-slate-400 transition-colors"
                      >
                        <Upload className="w-5 h-5 text-slate-300" />
                        <span className="text-[10px] text-slate-300 font-medium">新增</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Upload button when empty */}
                {photos.length === 0 && (
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    className="w-full bg-white rounded-3xl p-8 shadow-sm ring-1 ring-slate-100 flex flex-col items-center gap-3 hover:ring-slate-300 transition-all"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                      <ImageIcon className="w-7 h-7 text-slate-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-slate-700">點擊上傳生活照</p>
                      <p className="text-xs text-slate-400 mt-1">最多 5 張 · JPG / PNG / HEIC</p>
                    </div>
                  </button>
                )}

                {/* Count hint */}
                <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">已上傳</span>
                    <span className={cn(
                      'text-xs font-bold',
                      photos.length >= 3 ? 'text-emerald-500' : 'text-slate-400',
                    )}>
                      {photos.length} / 5 張 {photos.length >= 3 ? '✓ 符合最低要求' : '（需要至少 3 張）'}
                    </span>
                  </div>
                  <div className="flex gap-1 mt-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <div
                        key={n}
                        className={cn(
                          'flex-1 h-1.5 rounded-full transition-all duration-300',
                          n <= photos.length ? 'bg-emerald-400' : 'bg-slate-100',
                        )}
                      />
                    ))}
                  </div>
                </div>

                {/* Tips */}
                <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-600">照片建議</p>
                  {['正臉清晰、光線充足的近照', '戶外或生活場景（避免太過精修）', '能展現個性與生活風格的日常照'].map((tip) => (
                    <div key={tip} className="flex items-start gap-2">
                      <div className="w-1 h-1 rounded-full bg-slate-400 mt-1.5 flex-shrink-0" />
                      <p className="text-xs text-slate-500">{tip}</p>
                    </div>
                  ))}
                  <div className="flex items-start gap-2 pt-1">
                    <div className="w-1 h-1 rounded-full bg-slate-400 mt-1.5 flex-shrink-0" />
                    <p className="text-xs text-slate-500">上傳預覽會先做霧化處理，正式審核仍使用原始檔案。</p>
                  </div>
                </div>
              </>
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

                {/* Company selection */}
                <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    任職公司
                  </p>
                  <div className="flex gap-3">
                    {(['TSMC', 'MediaTek'] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setSelectedCompany(c)}
                        className={cn(
                          'flex-1 py-3.5 rounded-2xl text-sm font-bold border-2 transition-all flex flex-col items-center gap-1',
                          selectedCompany === c
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 text-slate-500 bg-white',
                        )}
                      >
                        <Cpu className="w-4 h-4" />
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

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
                    onClick={() => proofInputRef.current?.click()}
                    disabled={selectedCompany === ''}
                    className={cn(
                      'w-full rounded-3xl p-6 flex flex-col items-center gap-3 transition-all',
                      selectedCompany
                        ? 'bg-white ring-1 ring-slate-100 shadow-sm hover:ring-slate-300'
                        : 'bg-slate-50 ring-1 ring-slate-100 opacity-50 cursor-not-allowed',
                    )}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                      <Upload className="w-6 h-6 text-slate-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-slate-700">
                        {selectedCompany ? `上傳 ${selectedCompany} 驗證文件` : '請先選擇公司'}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">JPG / PNG / PDF</p>
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
                    非台積電或聯發科員工的申請將不予通過。審核時間約 1–3 個工作天。
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
                        onClick={() => incomeInputRef.current?.click()}
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
                    通過審核後，你可以到「編輯個人資訊」自行決定是否要顯示收入邊框。未通過前邊框不會顯示。
                  </p>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="px-5 pb-10 pt-4 space-y-3">
        <motion.button
          whileTap={{ scale: canAdvance ? 0.97 : 1 }}
          onClick={() => {
            if (!canAdvance) return
            if (isLastStep) handleSubmit()
            else setStep(step + 1)
          }}
          disabled={submitting || !canAdvance}
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

        <button onClick={onSkip} className="w-full text-slate-400 text-sm py-2">
          跳過（測試模式）
        </button>
      </div>
    </div>
  )
}
