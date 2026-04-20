import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Cpu, User, Briefcase, Coffee } from 'lucide-react'
import { cn } from '@/lib/utils'

const INTERESTS = [
  '精品咖啡', '登山', '底片攝影', '日本文學', '爵士吉他',
  '手沖咖啡', '電影', '重訓', '單車', '台式料理',
  '紀錄片', '城市規劃', '義式料理', '閱讀', '天文觀測',
  '黑膠唱片', '清酒', '植物', '烘焙', '游泳',
]

interface FormData {
  name: string
  age: string
  company: 'TSMC' | 'MediaTek' | ''
  role: string
  department: string
  interests: string[]
}

interface Props {
  onComplete: (data: FormData) => void
  onSkip: () => void
}

const STEPS = ['基本資料', '公司資訊', '興趣標籤']

export default function OnboardingScreen({ onComplete, onSkip }: Props) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormData>({
    name: '',
    age: '',
    company: '',
    role: '',
    department: '',
    interests: [],
  })

  const update = (key: keyof FormData, value: string | string[]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const toggleInterest = (tag: string) =>
    update(
      'interests',
      form.interests.includes(tag)
        ? form.interests.filter((t) => t !== tag)
        : [...form.interests, tag],
    )

  const canNext = () => {
    if (step === 0) return form.name.trim().length > 0 && form.age.trim().length > 0
    if (step === 1) return form.company !== '' && form.role.trim().length > 0
    return true
  }

  const next = () => {
    if (step < 2) setStep(step + 1)
    else onComplete(form)
  }

  return (
    <div className="min-h-dvh max-w-md mx-auto flex flex-col bg-[#fafafa]">
      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <div className="flex items-center gap-3 mb-6">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="w-8 h-8 rounded-full bg-white ring-1 ring-slate-100 shadow-sm flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
          )}
          <div className="flex-1">
            {/* Progress bar */}
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
            <p className="text-xs text-slate-400">{step + 1} / {STEPS.length} — {STEPS[step]}</p>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -20, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {step === 0 && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <User className="w-4 h-4 text-slate-400" />
                  <h2 className="text-xl font-bold text-slate-900">你好，先認識一下</h2>
                </div>
                <p className="text-sm text-slate-400">填寫基本資料，讓對方認識你</p>
              </div>
            )}
            {step === 1 && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Briefcase className="w-4 h-4 text-slate-400" />
                  <h2 className="text-xl font-bold text-slate-900">你在哪裡工作？</h2>
                </div>
                <p className="text-sm text-slate-400">公司驗證確保社群品質</p>
              </div>
            )}
            {step === 2 && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Coffee className="w-4 h-4 text-slate-400" />
                  <h2 className="text-xl font-bold text-slate-900">你喜歡什麼？</h2>
                </div>
                <p className="text-sm text-slate-400">選 3 個以上興趣，提升配對準確度</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Form */}
      <div className="flex-1 px-5 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="space-y-4"
          >
            {step === 0 && (
              <>
                <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">姓名</label>
                  <input
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    placeholder="你的名字"
                    className="mt-2 w-full text-slate-900 text-sm outline-none placeholder:text-slate-300 bg-transparent"
                  />
                </div>
                <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">年齡</label>
                  <input
                    value={form.age}
                    onChange={(e) => update('age', e.target.value)}
                    placeholder="例如：28"
                    type="number"
                    min="20"
                    max="60"
                    className="mt-2 w-full text-slate-900 text-sm outline-none placeholder:text-slate-300 bg-transparent"
                  />
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3 block">任職公司</label>
                  <div className="flex gap-3">
                    {(['TSMC', 'MediaTek'] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => update('company', c)}
                        className={cn(
                          'flex-1 py-3 rounded-xl text-sm font-semibold border-2 transition-all flex items-center justify-center gap-1.5',
                          form.company === c
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 text-slate-500',
                        )}
                      >
                        <Cpu className="w-3.5 h-3.5" />
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">職稱</label>
                  <input
                    value={form.role}
                    onChange={(e) => update('role', e.target.value)}
                    placeholder="例如：製程整合工程師"
                    className="mt-2 w-full text-slate-900 text-sm outline-none placeholder:text-slate-300 bg-transparent"
                  />
                </div>
                <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">部門（選填）</label>
                  <input
                    value={form.department}
                    onChange={(e) => update('department', e.target.value)}
                    placeholder="例如：N3 製程技術"
                    className="mt-2 w-full text-slate-900 text-sm outline-none placeholder:text-slate-300 bg-transparent"
                  />
                </div>
              </>
            )}

            {step === 2 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
                <div className="flex flex-wrap gap-2">
                  {INTERESTS.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => toggleInterest(tag)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                        form.interests.includes(tag)
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200',
                      )}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                {form.interests.length > 0 && (
                  <p className="mt-3 text-xs text-slate-400 text-right">已選 {form.interests.length} 個</p>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="px-5 pb-10 pt-4 space-y-3">
        <motion.button
          onClick={next}
          disabled={!canNext()}
          whileTap={{ scale: canNext() ? 0.97 : 1 }}
          className={cn(
            'w-full rounded-2xl py-4 font-semibold text-base flex items-center justify-center gap-2 transition-all',
            canNext()
              ? 'bg-slate-900 text-white shadow-lg'
              : 'bg-slate-100 text-slate-300',
          )}
        >
          {step < 2 ? '下一步' : '完成，開始配對'}
          <ChevronRight className="w-5 h-5" />
        </motion.button>

        <button
          onClick={onSkip}
          className="w-full text-slate-400 text-sm py-2"
        >
          跳過（測試模式）
        </button>
      </div>
    </div>
  )
}
