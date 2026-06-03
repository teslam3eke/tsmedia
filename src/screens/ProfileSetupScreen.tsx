import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight, ChevronLeft, Cpu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getProfile } from '@/lib/db'
import { REGION_LABELS, type Region } from '@/lib/types'

interface Props {
  userId?: string
  onComplete: (data: ProfileSetupData) => void
  /** 首次 onboarding：返回條款同意頁 */
  onBack?: () => void
  onBackToQuestionnaire?: () => void
  onReturnToVerify?: () => void
}

export interface ProfileSetupData {
  name: string
  nickname: string
  gender: 'male' | 'female'
  birthYear: string
  birthMonth: string
  interests: string[]
  bio: string
  workRegion: Region | ''
  homeRegion: Region | ''
  preferredRegion: Region | ''
}

import { PROFILE_INTEREST_TAGS } from '@/lib/profileInterestTags'

const GENDER_OPTIONS = [
  { value: 'male',   label: '男性' },
  { value: 'female', label: '女性' },
] as const

const YEARS = Array.from({ length: 35 }, (_, i) => String(2005 - i))
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))

export default function ProfileSetupScreen({
  userId,
  onComplete,
  onBack,
  onBackToQuestionnaire,
  onReturnToVerify,
}: Props) {
  const [form, setForm] = useState<ProfileSetupData>({
    name: '',
    nickname: '',
    gender: 'male',
    birthYear: '',
    birthMonth: '',
    interests: [],
    bio: '',
    workRegion: '',
    homeRegion: '',
    preferredRegion: '',
  })
  const [profileLoaded, setProfileLoaded] = useState(!userId)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      const p = await getProfile(userId)
      if (cancelled || !p) {
        if (!cancelled) setProfileLoaded(true)
        return
      }
      const approxBirthYear =
        p.age != null && p.age > 0 ? String(new Date().getFullYear() - p.age) : ''
      setForm({
        name: p.name?.trim() ?? '',
        nickname: p.nickname?.trim() ?? '',
        gender: p.gender === 'female' ? 'female' : 'male',
        birthYear: approxBirthYear,
        birthMonth: '',
        interests: p.interests ?? [],
        bio: p.bio?.trim() ?? '',
        workRegion: p.work_region ?? '',
        homeRegion: p.home_region ?? '',
        preferredRegion: p.preferred_region ?? '',
      })
      setProfileLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [userId])

  const set = <K extends keyof ProfileSetupData>(key: K, val: ProfileSetupData[K]) =>
    setForm((f) => ({ ...f, [key]: val }))

  const toggleInterest = (tag: string) =>
    set(
      'interests',
      form.interests.includes(tag)
        ? form.interests.filter((t) => t !== tag)
        : [...form.interests, tag],
    )

  const canSubmit =
    form.name.trim().length >= 2 &&
    form.nickname.trim().length >= 1 &&
    form.birthYear !== '' &&
    form.interests.length >= 3 &&
    form.workRegion !== '' &&
    form.homeRegion !== '' &&
    form.preferredRegion !== ''

  const REGIONS: Region[] = ['north', 'central', 'south', 'east']

  if (!profileLoaded) {
    return (
      <div className="max-w-md mx-auto min-h-[40vh] flex items-center justify-center px-6">
        <p className="text-sm text-slate-500">載入個人資料…</p>
      </div>
    )
  }

  const RegionGrid = ({
    value,
    onChange,
  }: {
    value: Region | ''
    onChange: (r: Region) => void
  }) => (
    <div className="grid grid-cols-4 gap-2">
      {REGIONS.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={cn(
            'py-2.5 rounded-xl text-sm font-semibold border-2 transition-all',
            value === r
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 text-slate-500 bg-white',
          )}
        >
          {REGION_LABELS[r]}
        </button>
      ))}
    </div>
  )

  return (
    <div className="max-w-md mx-auto bg-[#fafafa]">
      {/* Header */}
      <div className="px-5 pt-safe pb-6 border-b border-slate-100">
        {(onBack || onBackToQuestionnaire || onReturnToVerify) && (
          <div className="flex items-center gap-2 mb-3">
            {(onBack || onBackToQuestionnaire) && (
              <button
                type="button"
                onClick={onBack ?? onBackToQuestionnaire}
                className="flex items-center gap-1 text-sm font-semibold text-slate-500 active:text-slate-800"
              >
                <ChevronLeft className="w-4 h-4" />
                上一頁
              </button>
            )}
            {onReturnToVerify ? (
              <button
                type="button"
                onClick={onReturnToVerify}
                className="ml-auto text-xs font-semibold text-slate-500 active:text-slate-800"
              >
                返回審核等待
              </button>
            ) : null}
          </div>
        )}
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center">
            <Cpu className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-xs text-slate-400 tracking-widest uppercase font-medium">基本資料</span>
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900" style={{ letterSpacing: '-0.03em' }}>
          讓對方認識你
        </h1>
        <p className="text-sm text-slate-400 mt-1">真實姓名只用於認證；探索頁會顯示暱稱</p>
      </div>

      {/* Form — single scrollable page */}
      <div className="px-5 py-6 space-y-5">

        {/* Name */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
            真實姓名 <span className="text-red-400">*</span>
          </label>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="僅用於認證，不會公開顯示"
            className="w-full bg-white rounded-2xl px-4 py-3.5 text-sm text-slate-900 placeholder:text-slate-300 shadow-sm ring-1 ring-slate-100 focus:ring-slate-300 outline-none transition-all"
          />
        </motion.div>

        {/* Nickname */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
            暱稱 <span className="text-red-400">*</span>
          </label>
          <input
            value={form.nickname}
            onChange={(e) => set('nickname', e.target.value)}
            placeholder="對方看到的顯示名稱"
            className="w-full bg-white rounded-2xl px-4 py-3.5 text-sm text-slate-900 placeholder:text-slate-300 shadow-sm ring-1 ring-slate-100 focus:ring-slate-300 outline-none transition-all"
          />
        </motion.div>

        {/* Gender */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.11 }}>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
            性別 <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-2">
            {GENDER_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => set('gender', value)}
                className={cn(
                  'flex-1 py-3 rounded-2xl text-sm font-semibold border-2 transition-all',
                  form.gender === value
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 text-slate-500 bg-white',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Birthday */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
            生日 <span className="text-red-400">*</span>
          </label>
          <div className="flex gap-2">
            <select
              value={form.birthYear}
              onChange={(e) => set('birthYear', e.target.value)}
              className={cn(
                'flex-1 bg-white rounded-2xl px-4 py-3.5 text-sm shadow-sm ring-1 ring-slate-100 outline-none appearance-none transition-all',
                form.birthYear ? 'text-slate-900' : 'text-slate-300',
              )}
            >
              <option value="" disabled>年</option>
              {YEARS.map((y) => <option key={y} value={y}>{y} 年</option>)}
            </select>
            <select
              value={form.birthMonth}
              onChange={(e) => set('birthMonth', e.target.value)}
              className={cn(
                'w-28 bg-white rounded-2xl px-4 py-3.5 text-sm shadow-sm ring-1 ring-slate-100 outline-none appearance-none transition-all',
                form.birthMonth ? 'text-slate-900' : 'text-slate-300',
              )}
            >
              <option value="" disabled>月</option>
              {MONTHS.map((m) => <option key={m} value={m}>{m} 月</option>)}
            </select>
          </div>
        </motion.div>

        {/* Work Region */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
            工作地點 <span className="text-red-400">*</span>
          </label>
          <RegionGrid value={form.workRegion} onChange={(r) => set('workRegion', r)} />
        </motion.div>

        {/* Home Region */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
            戶籍地 <span className="text-red-400">*</span>
          </label>
          <RegionGrid value={form.homeRegion} onChange={(r) => set('homeRegion', r)} />
        </motion.div>

        {/* Preferred Region */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.165 }}>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
              希望配對的對象所在地 <span className="text-red-400">*</span>
            </label>
          </div>
          <RegionGrid value={form.preferredRegion} onChange={(r) => set('preferredRegion', r)} />
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            對方的工作地或戶籍地其中一個符合就會出現在探索頁
          </p>
        </motion.div>

        {/* Interests */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.17 }}>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
              興趣標籤 <span className="text-red-400">*</span>
            </label>
            <span className={cn(
              'text-xs font-semibold transition-colors',
              form.interests.length >= 3 ? 'text-emerald-500' : 'text-slate-400',
            )}>
              {form.interests.length >= 3
                ? `✓ 已選 ${form.interests.length} 個`
                : `至少選 3 個（已選 ${form.interests.length}）`}
            </span>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
            <div className="flex flex-wrap gap-2">
              {PROFILE_INTEREST_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleInterest(tag)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                    form.interests.includes(tag)
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200',
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Bio — optional */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.20 }}>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
            自我介紹 <span className="text-slate-300 font-normal normal-case">（選填）</span>
          </label>
          <textarea
            value={form.bio}
            onChange={(e) => set('bio', e.target.value)}
            placeholder="用幾句話介紹生活與個性即可，不必寫公司或職稱⋯"
            rows={3}
            className="w-full bg-white rounded-2xl px-4 py-3.5 text-sm text-slate-900 placeholder:text-slate-300 shadow-sm ring-1 ring-slate-100 focus:ring-slate-300 outline-none resize-none transition-all leading-relaxed"
          />
        </motion.div>

        {/* CTA — in normal flow, no sticky */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="pt-2 pb-12 space-y-3"
        >
          <motion.button
            whileTap={{ scale: canSubmit ? 0.97 : 1 }}
            onClick={() => canSubmit && onComplete(form)}
            disabled={!canSubmit}
            className={cn(
              'w-full rounded-2xl py-4 font-bold text-base flex items-center justify-center gap-2 transition-all',
              canSubmit
                ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20'
                : 'bg-slate-100 text-slate-300',
            )}
          >
            下一步：價值觀評估
            <ChevronRight className="w-5 h-5" />
          </motion.button>
        </motion.div>

      </div>
    </div>
  )
}
