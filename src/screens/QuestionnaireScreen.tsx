import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, ChevronLeft, MessageSquare, Cpu } from 'lucide-react'
import { getRandomQuestions, type Question, type QuestionCategory } from '@/utils/questions'
import { cn } from '@/lib/utils'

interface Props {
  onComplete: (answers: Record<number, string>, questions: Question[]) => void
  onSkip: () => void
}

const CATEGORY_COLORS: Record<QuestionCategory, { bg: string; text: string; dot: string }> = {
  '金錢觀': { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  '工作與生活平衡': { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-400' },
  '未來規劃與自尊': { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-400' },
}

const MIN_CHARS = 20

export default function QuestionnaireScreen({ onComplete, onSkip }: Props) {
  const questions = useMemo(() => getRandomQuestions(5), [])
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<number, string>>({})

  const q: Question = questions[current]
  const answer = answers[q.id] ?? ''
  const isValid = answer.trim().length >= MIN_CHARS
  const isLast = current === questions.length - 1
  const allAnswered = questions.every((question) => (answers[question.id] ?? '').trim().length >= MIN_CHARS)

  const goNext = () => {
    if (isLast) {
      if (allAnswered) onComplete(answers, questions)
    } else {
      setCurrent((c) => c + 1)
    }
  }

  const goPrev = () => {
    if (current > 0) setCurrent((c) => c - 1)
  }

  const colors = CATEGORY_COLORS[q.category]
  const progress = ((current + 1) / questions.length) * 100

  return (
    <div className="max-w-md mx-auto bg-[#fafafa]">
      {/* Header */}
      <div className="px-5 pt-12 pb-4">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 mb-5"
        >
          <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center">
            <Cpu className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-slate-400 text-xs tracking-widest uppercase font-medium">
            價值觀評估
          </span>
        </motion.div>

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-500">
              第 {current + 1} 題 · 共 5 題
            </span>
            <span className="text-xs text-slate-400">{Math.round(progress)}% 完成</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-slate-900 rounded-full"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          {/* Step dots */}
          <div className="flex gap-1 pt-0.5">
            {questions.map((_, i) => (
              <div
                key={i}
                className={cn(
                  'flex-1 h-1 rounded-full transition-all duration-300',
                  i < current ? 'bg-slate-900' : i === current ? 'bg-slate-500' : 'bg-slate-200',
                )}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Question card */}
      <div className="px-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={q.id}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="h-full flex flex-col gap-4"
          >
            {/* Category badge */}
            <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 w-fit ${colors.bg}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
              <span className={`text-xs font-semibold ${colors.text}`}>{q.category}</span>
            </div>

            {/* Question text */}
            <div className="bg-white rounded-3xl p-5 shadow-sm ring-1 ring-slate-100">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <MessageSquare className="w-4 h-4 text-white" />
                </div>
                <p className="text-base font-semibold text-slate-900 leading-relaxed flex-1">
                  {q.text}
                </p>
              </div>
            </div>

            {/* Answer textarea */}
            <div className="flex flex-col gap-1.5">
              <textarea
                value={answer}
                onChange={(e) =>
                  setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                }
                onFocus={(e) => {
                  const el = e.currentTarget
                  setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
                }}
                placeholder="請以開放式文字作答，說明你的真實想法與做法⋯"
                rows={6}
                className={cn(
                  'w-full bg-white rounded-3xl p-5 text-sm text-slate-900 placeholder:text-slate-300',
                  'shadow-sm ring-1 resize-none outline-none leading-relaxed transition-all duration-200',
                  answer.trim().length > 0 && !isValid
                    ? 'ring-amber-200 focus:ring-amber-300'
                    : isValid
                    ? 'ring-emerald-200 focus:ring-emerald-300'
                    : 'ring-slate-100 focus:ring-slate-300',
                )}
              />
              <div className="flex justify-between px-1">
                <span className={cn(
                  'text-xs transition-colors',
                  isValid ? 'text-emerald-500' : 'text-slate-400',
                )}>
                  {isValid ? '✓ 回答足夠詳細' : `至少需要 ${MIN_CHARS} 字（目前 ${answer.trim().length} 字）`}
                </span>
                <span className="text-xs text-slate-300">{answer.length}</span>
              </div>
            </div>

            {/* Navigation hint */}
            {!isLast && (
              <p className="text-xs text-slate-400 text-center px-4 leading-relaxed">
                你的回答將用於 AI 契合度分析，請如實填寫。
              </p>
            )}
            {isLast && (
              <div className="bg-slate-50 rounded-2xl p-4 text-center">
                <p className="text-xs text-slate-500 leading-relaxed">
                  最後一題！完成後系統將根據你的價值觀進行精準配對分析。
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer nav */}
      <div className="px-5 pb-12 pt-4 flex gap-3">
        {current > 0 && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={goPrev}
            className="w-12 h-14 flex-shrink-0 bg-white rounded-2xl shadow-sm ring-1 ring-slate-100 flex items-center justify-center"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </motion.button>
        )}

        <motion.button
          whileTap={{ scale: isValid ? 0.97 : 1 }}
          onClick={goNext}
          disabled={!isValid}
          className={cn(
            'flex-1 h-14 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all duration-200',
            isValid
              ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20'
              : 'bg-slate-100 text-slate-300',
          )}
        >
          {isLast ? (allAnswered ? '提交作答' : '請完整作答') : '下一題'}
          <ChevronRight className="w-5 h-5" />
        </motion.button>
      </div>

      {/* Skip */}
      <div className="px-5 pb-6 -mt-4 text-center">
        <button onClick={onSkip} className="text-slate-400 text-xs py-1">
          跳過（測試模式）
        </button>
      </div>
    </div>
  )
}
