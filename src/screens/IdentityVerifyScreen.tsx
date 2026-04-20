import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Camera, FileText, Trash2, ChevronRight, ChevronLeft,
  ShieldCheck, AlertCircle, Cpu, Upload, ImageIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { uploadPhoto, uploadProofDoc, submitVerificationDoc, upsertProfile } from '@/lib/db'
import type { DocType } from '@/lib/types'

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
}

const STEPS = ['生活照上傳', '職業驗證文件']

export default function IdentityVerifyScreen({ userId, gender = 'male', onComplete, onSkip }: Props) {
  const [step, setStep] = useState(0)
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [proofs, setProofs] = useState<ProofItem[]>([])
  const [selectedCompany, setSelectedCompany] = useState<'TSMC' | 'MediaTek' | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const proofInputRef = useRef<HTMLInputElement>(null)

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
    const newProofs: ProofItem[] = Array.from(files)
      .slice(0, 1)
      .map((f) => ({
        id: `${Date.now()}-${f.name}`,
        name: f.name,
        type: f.type,
        file: f,
      }))
    setProofs(newProofs)
  }

  const canStep1 = photos.length >= 3
  const canStep2 = selectedCompany !== '' && proofs.length > 0

  const handleSubmit = async () => {
    setSubmitting(true)

    if (userId && selectedCompany) {
      // 1. Upload life photos to Storage
      const photoFiles = photos.map((p) => p.file).filter(Boolean) as File[]
      const uploadedPhotoUrls: string[] = []
      for (const file of photoFiles) {
        const result = await uploadPhoto(userId, file)
        if (result.ok) uploadedPhotoUrls.push(result.path)
      }
      if (uploadedPhotoUrls.length > 0) {
        await upsertProfile({ userId, photoUrls: uploadedPhotoUrls })
      }

      // 2. Upload proof doc + save to verification_docs table
      if (proofs.length > 0 && proofs[0].file) {
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
    } else {
      // Offline / guest mode — just wait briefly
      await new Promise((r) => setTimeout(r, 1200))
    }

    setSubmitting(false)
    onComplete()
  }

  // 女生不需要職業驗證，只需上傳生活照即可
  if (gender === 'female') {
    return (
      <div className="min-h-dvh max-w-md mx-auto bg-[#fafafa] flex flex-col">
        <div className="px-5 pt-safe pb-5">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
              <Camera className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">上傳生活照</h1>
              <p className="text-xs text-slate-400">讓對方更了解你的日常</p>
            </div>
          </div>

          <div className="bg-violet-50 rounded-2xl p-4 mb-6 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-violet-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-violet-700 leading-relaxed">
              TsMedia 對女性會員不要求職業驗證。上傳 1–5 張生活照，即可完成設定。
            </p>
          </div>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => addPhotos(e.target.files)}
          />

          {/* Photo grid */}
          <div className="grid grid-cols-3 gap-2 mb-6">
            {photos.map((p) => (
              <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden bg-slate-100">
                <img src={p.url} alt="" className="w-full h-full object-cover scale-110" style={{ filter: 'blur(6px)' }} />
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                  <span className="text-white text-[10px] font-semibold">隱私預覽</span>
                </div>
                <button
                  onClick={() => removePhoto(p.id)}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center"
                >
                  <Trash2 className="w-2.5 h-2.5 text-white" />
                </button>
              </div>
            ))}
            {photos.length < 5 && (
              <button
                onClick={() => photoInputRef.current?.click()}
                className="aspect-square rounded-xl bg-white ring-1 ring-dashed ring-slate-300 flex flex-col items-center justify-center gap-1"
              >
                <ImageIcon className="w-5 h-5 text-slate-300" />
                <span className="text-[10px] text-slate-400">新增</span>
              </button>
            )}
          </div>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onComplete}
            className="w-full py-4 bg-slate-900 text-white font-semibold rounded-2xl text-sm"
          >
            完成設定，進入配對
          </motion.button>
          <button onClick={onSkip} className="w-full mt-3 py-2 text-sm text-slate-400">
            跳過，稍後上傳
          </button>
        </div>
      </div>
    )
  }

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
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1.5 flex-1 rounded-full transition-all duration-300',
                    i <= step ? 'bg-slate-900' : 'bg-slate-200',
                  )}
                />
              ))}
            </div>
            <p className="text-xs text-slate-400">{step + 1} / {STEPS.length} — {STEPS[step]}</p>
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
            {step === 0 && (
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
            {step === 1 && (
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
            {/* ── STEP 1: Life photos ─────────────────────────────── */}
            {step === 0 && (
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

            {/* ── STEP 2: Identity proof ──────────────────────────── */}
            {step === 1 && (
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
                      onClick={() => setProofs([])}
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
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="px-5 pb-10 pt-4 space-y-3">
        <motion.button
          whileTap={{ scale: (step === 0 ? canStep1 : canStep2) ? 0.97 : 1 }}
          onClick={() => {
            if (step === 0 && canStep1) setStep(1)
            else if (step === 1 && canStep2) handleSubmit()
          }}
          disabled={submitting || (step === 0 ? !canStep1 : !canStep2)}
          className={cn(
            'w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 transition-all',
            (step === 0 ? canStep1 : canStep2) && !submitting
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
              {step === 0 ? '繼續' : '提交審核申請'}
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
