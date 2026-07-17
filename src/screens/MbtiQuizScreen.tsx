import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MBTI_QUESTIONS,
  computeMbtiType,
  type MbtiChoice,
  type MbtiQuestion,
} from '@/utils/mbtiQuestions'
import {
  loadOnboardingJsonDraft,
  saveOnboardingJsonDraft,
  useOnboardingForegroundRepair,
} from '@/lib/onboardingDraft'

interface Props {
  onComplete: (mbtiType: ReturnType<typeof computeMbtiType>) => void
  userId?: string
  onBack?: () => void
  onReturnToVerify?: () => void
  returnGateLabel?: string
}

export default function MbtiQuizScreen({
  onComplete,
  userId,
  onBack,
  onReturnToVerify,
  returnGateLabel = '返回驗證頁',
}: Props) {
  const questions = MBTI_QUESTIONS
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<number, MbtiChoice>>({})
  const [answersLoaded, setAnswersLoaded] = useState(!userId)
  const [resultType, setResultType] = useState<ReturnType<typeof computeMbtiType> | null>(null)
  const answersRef = useRef(answers)
  answersRef.current = answers

  useOnboardingForegroundRepair(true)

  useEffect(() => {
    if (!userId) return
    const draft = loadOnboardingJsonDraft<{ answers: Record<number, MbtiChoice>; current: number }>(
      userId,
      'mbti-quiz',
    )
    if (draft?.answers && Object.keys(draft.answers).length > 0) {
      setAnswers(draft.answers)
    }
    if (typeof draft?.current === 'number' && draft.current >= 0) {
      setCurrent(Math.min(draft.current, questions.length - 1))
    }
    setAnswersLoaded(true)
  }, [userId, questions.length])

  useEffect(() => {
    if (!answersLoaded) return
    saveOnboardingJsonDraft(userId, 'mbti-quiz', { answers, current })
  }, [answers, current, answersLoaded, userId])

  if (!answersLoaded) {
    return (
      <div className="max-w-md mx-auto min-h-[40vh] flex items-center justify-center px-6">
        <p className="text-sm text-slate-500">載入測驗…</p>
      </div>
    )
  }

  const q: MbtiQuestion = questions[current]
  const selected = answers[q.id]
  const isLast = current === questions.length - 1
  const allAnswered = questions.every((question) => answers[question.id] != null)
  const progress = ((current + 1) / questions.length) * 100

  const pick = (choice: MbtiChoice) => {
    setAnswers((prev) => ({ ...prev, [q.id]: choice }))
  }

  const goNext = () => {
    if (!selected) return
    if (isLast) {
      if (allAnswered) setResultType(computeMbtiType(answersRef.current))
    } else {
      setCurrent((c) => c + 1)
    }
  }

  if (resultType) {
    return (
      <div className="max-w-md mx-auto bg-[#fafafa] min-h-dvh flex flex-col px-5 pt-safe pb-safe">
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <Sparkles className="w-10 h-10 text-violet-500 mb-4" />
          <p className="text-sm font-semibold text-violet-700">你的人格類型</p>
          <p className="mt-3 text-5xl font-black tracking-widest text-slate-900">{resultType}</p>
          <p className="mt-4 text-sm text-slate-500 leading-relaxed max-w-xs">
            會顯示在探索頁年齡旁；之後可在「編輯個人資訊」直接修改。
          </p>
        </div>
        <button
          type="button"
          onClick={() => onComplete(resultType)}
          className="w-full py-3.5 rounded-2xl bg-slate-900 text-white text-sm font-bold mb-2"
        >
          繼續
        </button>
      </div>
    )
  }

  const goPrev = () => {
    if (current > 0) setCurrent((c) => c - 1)
  }

  return (
    <div className="max-w-md mx-auto bg-[#fafafa] min-h-dvh flex flex-col">
      <div className="px-5 pt-safe pb-4">
        {(onBack || onReturnToVerify) && (
          <div className="flex items-center gap-2 mb-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-0.5 text-sm font-semibold text-slate-500"
              >
                <ChevronLeft className="w-4 h-4" />
                返回
              </button>
            )}
            {onReturnToVerify && (
              <button
                type="button"
                onClick={onReturnToVerify}
                className="ml-auto text-xs font-semibold text-slate-400"
              >
                {returnGateLabel}
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-violet-500" />
          <p className="text-xs font-bold text-violet-700 tracking-wide">人格測驗</p>
        </div>
        <h1 className="text-xl font-bold text-slate-900 leading-snug">了解你的 MBTI 類型</h1>
        <p className="text-sm text-slate-500 mt-1 leading-relaxed">
          約 {questions.length} 題，結果會顯示在探索頁年齡旁；之後可在「編輯個人資訊」直接修改。
        </p>

        <div className="mt-4 h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <motion.div
            className="h-full bg-violet-500 rounded-full"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.25 }}
          />
        </div>
        <p className="text-[11px] text-slate-400 mt-2 tabular-nums">
          第 {current + 1} / {questions.length} 題
        </p>
      </div>

      <div className="flex-1 px-5 pb-4 min-h-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={q.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.22 }}
            className="space-y-4"
          >
            <p className="text-lg font-semibold text-slate-900 leading-relaxed">{q.text}</p>

            <div className="space-y-3">
              {(['A', 'B'] as const).map((key) => {
                const opt = key === 'A' ? q.optionA : q.optionB
                const active = selected === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pick(key)}
                    className={cn(
                      'w-full text-left rounded-2xl px-4 py-4 ring-1 transition-all',
                      active
                        ? 'bg-violet-600 text-white ring-violet-600 shadow-md'
                        : 'bg-white text-slate-800 ring-slate-200 hover:ring-violet-200',
                    )}
                  >
                    <span className="text-sm font-semibold leading-relaxed">{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer nav — 與 QuestionnaireScreen 相同：非 sticky，留足底距避免 iOS 切掉 */}
      <div className="flex-none px-5 pt-4 pb-safe bg-[#fafafa] border-t border-slate-100">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={current === 0}
            className={cn(
              'flex items-center justify-center gap-1 px-4 py-3 rounded-2xl text-sm font-bold ring-1',
              current === 0
                ? 'text-slate-300 ring-slate-100'
                : 'text-slate-600 ring-slate-200 bg-white',
            )}
          >
            <ChevronLeft className="w-4 h-4" />
            上一題
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!selected}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 py-3 rounded-2xl text-sm font-bold transition-all',
              selected
                ? 'bg-slate-900 text-white'
                : 'bg-slate-200 text-slate-400',
            )}
          >
            {isLast ? '查看結果' : '下一題'}
            {!isLast && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
